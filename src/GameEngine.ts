import { Dimensions } from "react-native";
import seedrandom from "seedrandom";

import { swipeDirections } from "@/components/GestureView";
import AudioManager from "./AudioManager";
import { MultiAIClient } from "./ai/MultiAIClient";
import {
  CrossyCamera,
  CrossyGameMap,
  CrossyRenderer,
  CrossyScene,
} from "./CrossyGame";
import CrossyPlayer from "./CrossyPlayer";
import {
  CAMERA_EASING,
  DEBUG_CAMERA_CONTROLS,
  groundLevel,
  PI_2,
  sceneColor,
  startingRow,
} from "./GameSettings";

const normalizeAngle = (angle) => {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
};

export default class Engine {
  seed: string;
  gameSpeed = 1;
  cameraMode: 'all' | 'lead' | number = 'all';
  currentZoom: number = 400;

  constructor(seed?: string) {
    this.seed = seed || Math.random().toString();
    try {
      if (typeof seedrandom === 'function') {
        seedrandom(this.seed, { global: true });
      }
    } catch (e) {
      console.warn("Could not initialize seedrandom. Using default Math.random.", e);
    }
  }

  updateScale() {
    const { width, height, scale } = Dimensions.get("window");
    if (this.camera) {
      this.camera.updateScale({ width, height, scale, zoom: this.currentZoom });
    }
    if (this.renderer) {
      this.renderer.setSize(width * scale, height * scale);
    }
  };

  setZoom(zoom: number) {
    this.currentZoom = zoom;
    this.updateScale();
  }
  
  enableAI() {
    this.aiMode = true;
    this.populationSize = 0; // unknown until server responds

    this.multiAI = new MultiAIClient(0);

    // ← This fires AFTER WS connects and server sends config
    this.multiAI.onConfig = (
      populationSize: number,
      stagnationTimeout: number,
      moveInterval: number,
      learningMode: boolean     
    ) => {
      this.populationSize = populationSize;
      this.stagnationTimeoutSeconds = stagnationTimeout;
      this.stagnationTimeoutTicks = stagnationTimeout * 60;
      this.multiAI!.moveInterval = moveInterval;        // ← now defined
      this.multiAI!.resizePendingActions(populationSize);

      this._learningMode = learningMode;

      this.setupGame(this._currentCharacter, this._learningMode);
      this.init();
    };


    this.multiAI.onReadyForNextGeneration = () => {
      this._generationEnding = false;
      this.initAIGeneration();
    };

    this.multiAI.onGenomeChange = (generation: number) => {
      console.log(`[AI] Starting generation ${generation}`);
    };
  }

  setupGame = (character, learningMode = false) => {
    this.scene = new CrossyScene({});
    this.camera = new CrossyCamera();

    if (DEBUG_CAMERA_CONTROLS) {
      // this.debugControls = new THREE.OrbitControls(this.camera);
    }

    this.scene.worldWithCamera.position.z = -startingRow;
    this.updateScale();

    this.gameMap = new CrossyGameMap({
      heroWidth: 0.7,
      scene: this.scene,
      onCollide: this.onCollide,
      learningMode,
    });

    this.camCount = 0;

    // Spawn populationSize heroes
    this._heroes = [];
    const count = this.aiMode ? this.populationSize : 1;
    for (let i = 0; i < count; i++) {
      const hero = new CrossyPlayer(character);
      // Spread heroes slightly apart on X so they're visually distinct
      hero.position.x = (i - (count - 1) / 2) * 0.6;
      this.scene.world.add(hero);
      this._heroes.push(hero);
    }

    // Lead hero drives the camera
    this._hero = this._heroes[0];

    this.scene.createParticles();
  };

  // ─── Init / reset for a new AI generation ────────────────────────────────────
  initAIGeneration = () => {
    this.onGameInit();

    this._heroScores      = Array(this._heroes.length).fill(0);
    this._heroTicksAlive  = Array(this._heroes.length).fill(0);
    this._heroLastScores  = Array(this._heroes.length).fill(0);
    this._heroStagnationTicks = Array(this._heroes.length).fill(0);

    this.camera.position.z = 1;
    this.scene.resetParticles(this._heroes[0].position);
    this.camCount = 0;
    this.gameMap.reset();

    this._heroTicksAlive = Array(this._heroes.length).fill(0);
    this._heroScores = Array(this._heroes.length).fill(0);
    this._generationEnding = false;

    this._heroes.forEach((h) => {
      h.reset();
      h.idle();
    });

    this.gameMap.init();
    this.onGameReady();
  };

  // ─── Init (single player / first start) ──────────────────────────────────────
  init = () => {
    if (this.aiMode) {
      this.initAIGeneration();
      return;
    }

    this.onGameInit();
    this.camera.position.z = 1;
    this._hero.reset();
    this.scene.resetParticles(this._hero.position);
    this.camCount = 0;
    this.gameMap.reset();
    this._hero.idle();
    this.gameMap.init();
    this.onGameReady();
    this.gameSpeed = 3;
  };

  // ─── isGameEnded: true only if ALL heroes are dead (or UI ended) ──────────────
  isGameEnded() {
    if (this._isGameStateEnded()) return true;
    if (this.aiMode) return this._heroes.every((h) => !h.isAlive);
    return !this._hero.isAlive;
  }

  // ─── Collision handler (called per hero by the game map) ─────────────────────
  onCollide = async (obstacle = {}, type = "feathers", collision) => {
    // In AI mode the row passes the actual player object — find it in _heroes
    // The row calls onCollide after checking collision against whichever hero
    // was passed to gameMap.tick(), which is now per-hero. So this._hero
    // is temporarily set to the correct hero before this fires.
    const dyingHero = this._currentCollidingHero ?? this._hero;

    if (!dyingHero.isAlive) return;
    dyingHero.isAlive = false;
    dyingHero.stopIdle();


    if (collision === "car") {
      AudioManager.playCarHitSound();
      AudioManager.playDeathSound();
    } else if (collision === "train") {
      await AudioManager.playAsync(AudioManager.sounds.train.die[`0`]);
      AudioManager.playDeathSound();
    }

    this.scene.useParticle(dyingHero, type, obstacle.speed);
    this.scene.rumble();

    if (!this.aiMode) {
      this.gameOver();
    }
  };

  // ─── Camera / map scroll ─────────────────────────────────────────────────────
  forwardScene = () => {
    let targetZ = 0;
    let targetX = 0;
    let targetZoom = 400;

    const livingHeroes = this.aiMode
      ? this._heroes.filter((h) => h.isAlive)
      : [this._hero].filter((h) => h?.isAlive);

    if (livingHeroes.length === 0) {
      // Keep current
      targetZ = this.scene.world.position.z;
      targetX = this.scene.world.position.x;
      targetZoom = this.currentZoom;
    } else if (this.aiMode && this.cameraMode === 'all') {
      let minZ = Infinity;
      let maxZ = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;

      livingHeroes.forEach((h) => {
        if (h.position.z < minZ) minZ = h.position.z;
        if (h.position.z > maxZ) maxZ = h.position.z;
        if (h.position.x < minX) minX = h.position.x;
        if (h.position.x > maxX) maxX = h.position.x;
      });

      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;

      targetZ = -(centerZ - startingRow);
      // Removed constraints for all mode to center
      targetX = -centerX;

      // Calculate required zoom
      const spreadZ = maxZ - minZ;
      const spreadX = maxX - minX;

      const baseZoom = 400; // Original zoom

      // We want to zoom out enough to fit both X and Z spreads.
      // E.g. screen height might correspond to roughly ~10 units. Screen width roughly ~15 units at base zoom.
      // We scale zoom inversely with spread.
      const padding = 2; // Extra units of padding

      const { width, height } = Dimensions.get("window");
      const aspect = width / height;

      // Magic numbers based on the orthographic camera setup
      const visibleZAtBase = 15;
      const visibleXAtBase = 15 * aspect;

      const reqZoomZ = baseZoom / Math.max(1, (spreadZ + padding) / visibleZAtBase);
      const reqZoomX = baseZoom / Math.max(1, (spreadX + padding) / visibleXAtBase);

      targetZoom = Math.min(reqZoomX, reqZoomZ, baseZoom);

    } else {
      let targetHero = livingHeroes[0];

      if (this.aiMode && this.cameraMode === 'lead') {
        targetHero = [...livingHeroes].sort((a, b) => b.position.z - a.position.z)[0];
      } else if (this.aiMode && typeof this.cameraMode === 'number') {
        targetHero = this._heroes[this.cameraMode];
        if (!targetHero || !targetHero.isAlive) {
            // Fallback to lead if the selected hero is dead or invalid
            targetHero = [...livingHeroes].sort((a, b) => b.position.z - a.position.z)[0];
            this.cameraMode = 'lead';
        }
      }

      targetZ = -(targetHero.position.z - startingRow);
      targetX = Math.max(-3, Math.min(2, -targetHero.position.x));
      targetZoom = 400; // default zoom for single player tracking
    }

    // Apply Easing
    this.scene.world.position.z += (targetZ - this.scene.world.position.z) * CAMERA_EASING;
    this.scene.world.position.x += (targetX - this.scene.world.position.x) * CAMERA_EASING;

    if (Math.abs(this.currentZoom - targetZoom) > 0.1) {
        this.currentZoom += (targetZoom - this.currentZoom) * 0.1;
        this.updateScale();
    }

    if (-this.scene.world.position.z - this.camCount > 1.0) {
      this.camCount = -this.scene.world.position.z;
      this.gameMap.newRow();
    }
  };

  // ─── Game over (single player) ───────────────────────────────────────────────
  gameOver = () => {
    this._hero.moving = false;
    this._hero.stopAnimations();
    this.onGameEnded();
  };

  // ─── Main tick ───────────────────────────────────────────────────────────────
  tick = (dt) => {
    if (this.aiMode) {
      this._aiTick(dt);
    } else {
      this._singlePlayerTick(dt);
    }
    this.forwardScene();
  };

  _singlePlayerTick = (dt) => {
    this.gameMap.tick(dt, this._hero);
    if (!this._hero.moving) {
      this._hero.moveOnEntity();
      this._hero.moveOnCar();
      this.checkIfUserHasFallenOutOfFrame(this._hero);
    }
  };

  _aiTick = (dt) => {
    // Move entities once per frame — use first LIVING hero for position reference
    const leadHero = this._heroes.find((h) => h.isAlive) ?? this._heroes[0];
    this.gameMap.tick(dt, leadHero);

    // Collision checks per hero
    this._heroes.forEach((hero) => {
      if (hero.isAlive) {
        this._currentCollidingHero = hero;
        this.gameMap.tickCollisionsOnly(hero);
      }
    });
    this._currentCollidingHero = null;

    //    Per-hero update
    this._heroes.forEach((hero, i) => {
      if (!hero.isAlive) return;

      if (!hero.moving) {
        hero.moveOnEntity();
        hero.moveOnCar();
        this._checkHeroOutOfFrame(hero, i);
      }

      this._heroTicksAlive[i]++;
      this._heroScores[i] = Math.max(Math.floor(hero.position.z) - 8, 0);

      // ── Stagnation timeout ────────────────────────────────────────
      if (this._heroScores[i] > (this._heroLastScores[i] ?? 0)) {
        this._heroLastScores[i] = this._heroScores[i];
        this._heroStagnationTicks[i] = 0;
      } else {
        this._heroStagnationTicks[i] = (this._heroStagnationTicks[i] ?? 0) + 1;
        if (this._heroStagnationTicks[i] >= this.stagnationTimeoutTicks) {
          console.log(`[AI] Hero ${i} stagnated — killing after ${this.stagnationTimeoutSeconds}s`);
          hero.isAlive = false;
          hero.stopAnimations();
          hero.stopIdle();
        }
      }

      const currentScore = Math.max(Math.floor(hero.position.z) - startingRow, 0);
      // Always store the PEAK score, never let it decrease
      if (currentScore > this._heroScores[i]) {
        this._heroScores[i] = currentScore;
      }

    });

    // AI input
    if (this.multiAI) {
      this.multiAI.tick(
        this._heroes,
        this.gameMap,
        (playerIndex: number, direction: string) => {
          this._moveHeroWithDirection(this._heroes[playerIndex], direction);
        }
      );
    }

    // All dead → send generation results to Python
    if (
      !this._generationEnding &&
      this._heroes.length > 0 &&
      this._heroes.every((h) => !h.isAlive)
    ) {
      this._generationEnding = true;
      this.multiAI?.sendGenerationOver(this._heroScores, this._heroTicksAlive);
    }
  };

  // ─── Out-of-frame check (per hero) ───────────────────────────────────────────
  checkIfUserHasFallenOutOfFrame = (hero?: CrossyPlayer) => {
    const h = hero ?? this._hero;
    if (!h.isAlive) return;

    if (h.position.z < this.camera.position.z - 1) {
      this.scene.rumble();
      if (this.aiMode) { h.isAlive = false; } else { this.gameOver(); }
      AudioManager.playDeathSound();
      return;
    }
    if (h.position.x < -5 || h.position.x > 5) {
      this.scene.rumble();
      if (this.aiMode) { h.isAlive = false; } else { this.gameOver(); }
      AudioManager.playDeathSound();
    }
  };

  _checkHeroOutOfFrame = (hero: CrossyPlayer, index: number) => {
    this.checkIfUserHasFallenOutOfFrame(hero);
  };

  // ─── Pause / unpause ─────────────────────────────────────────────────────────
  pause() {
    cancelAnimationFrame(this.raf);
  }

  unpause() {
    let lastTime = Date.now();
    const render = () => {
      this.raf = requestAnimationFrame(render);
      const now = Date.now();
      const rawDt = now - lastTime;
      lastTime = now;
      const dt = rawDt * this.gameSpeed; // ← apply speed multiplier
      this.tick(dt);
      this.renderer.render(this.scene, this.camera);
      this.renderer.__gl.endFrameEXP();
    };
    render();
  }

  // ─── Score ───────────────────────────────────────────────────────────────────
  updateScore = () => {
    const position = Math.max(Math.floor(this._hero.position.z) - 8, 0);
    this.onUpdateScore(position);
  };

  // ─── Move a specific hero with direction ─────────────────────────────────────
  _moveHeroWithDirection = (hero: CrossyPlayer, direction: string) => {
    if (!hero.isAlive || this._isGameStateEnded()) return;

    const { SWIPE_UP, SWIPE_DOWN, SWIPE_LEFT, SWIPE_RIGHT } = swipeDirections;

    hero.ridingOn = null;

    if (!hero.initialPosition) {
      hero.initialPosition = hero.position;
      hero.targetPosition = hero.initialPosition;
    }

    hero.skipPendingMovement();

    let velocity = { x: 0, z: 0 };
    hero.targetRotation = normalizeAngle(hero.rotation.y);

    switch (direction) {
      case SWIPE_LEFT:
        hero.targetRotation = PI_2;
        velocity = { x: 1, z: 0 };
        hero.targetPosition = {
          x: hero.initialPosition.x + 1,
          y: hero.initialPosition.y,
          z: hero.initialPosition.z,
        };
        hero.moving = true;
        break;

      case SWIPE_RIGHT:
        if (hero.targetPosition === 0) {
          hero.targetPosition = -PI_2;
        } else if (
          (hero.targetRotation | 0) !== -(PI_2 | 0) &&
          (hero.targetRotation | 0) !== ((Math.PI + PI_2) | 0)
        ) {
          hero.targetRotation = Math.PI + PI_2;
        }
        velocity = { x: -1, z: 0 };
        hero.targetPosition = {
          x: hero.initialPosition.x - 1,
          y: hero.initialPosition.y,
          z: hero.initialPosition.z,
        };
        hero.moving = true;
        break;

      case SWIPE_UP: {
        hero.targetRotation = 0;
        const rowObject = this.gameMap.getRow(hero.initialPosition.z) || {};
        if (rowObject.type === "road") AudioManager.playPassiveCarSound();

        velocity = { x: 0, z: 1 };
        hero.targetPosition = {
          x: hero.initialPosition.x,
          y: hero.initialPosition.y,
          z: hero.initialPosition.z + 1,
        };

        hero.targetPosition.x = Math.round(hero.targetPosition.x);
        const { ridingOn } = hero;
        if (ridingOn && ridingOn.dir) {
          if (ridingOn.dir < 0) hero.targetPosition.x = Math.floor(hero.targetPosition.x);
          else if (ridingOn.dir > 0) hero.targetPosition.x = Math.ceil(hero.targetPosition.x);
          else hero.targetPosition.x = Math.round(hero.targetPosition.x);
        }
        hero.moving = true;
        break;
      }

      case SWIPE_DOWN: {
        hero.targetRotation = Math.PI;
        velocity = { x: 0, z: -1 };
        hero.targetPosition = {
          x: hero.initialPosition.x,
          y: hero.initialPosition.y,
          z: hero.initialPosition.z - 1,
        };

        hero.targetPosition.x = Math.round(hero.targetPosition.x);
        const { ridingOn } = hero;
        if (ridingOn && ridingOn.dir) {
          if (ridingOn.dir < 0) hero.targetPosition.x = Math.floor(hero.targetPosition.x);
          else if (ridingOn.dir > 0) hero.targetPosition.x = Math.ceil(hero.targetPosition.x);
          else hero.targetPosition.x = Math.round(hero.targetPosition.x);
        }
        hero.moving = true;
        break;
      }
    }

    if (this.gameMap.treeCollision(hero.targetPosition)) {
      hero.targetPosition = {
        x: hero.initialPosition.x,
        y: hero.initialPosition.y,
        z: hero.initialPosition.z,
      };
      hero.moving = false;
    }

    const targetRow =
      this.gameMap.getRow(hero.initialPosition.z + velocity.z) || {};
    let finalY = targetRow.entity?.top ?? groundLevel;

    if (targetRow.type === "water") {
      const ridable = targetRow.entity.getRidableForPosition(hero.targetPosition);
      if (!ridable) {
        finalY = targetRow.entity.getPlayerSunkenPosition();
      } else {
        finalY = targetRow.entity.getPlayerLowerBouncePositionForEntity(ridable);
      }
    }

    AudioManager.playMoveSound();
    hero.targetPosition.y = finalY;
    hero.commitMovementAnimations({ onComplete: () => this.updateScore() });
  };

  // ─── moveWithDirection (human / legacy entry point) ──────────────────────────
  moveWithDirection = (direction) => {
    if (this.isGameEnded()) return;
    this._moveHeroWithDirection(this._hero, direction);
  };

  beginMoveWithDirection = () => {
    if (this.isGameEnded()) return;
    this._hero.runPosieAnimation();
  };

  // ─── GL context ──────────────────────────────────────────────────────────────
  _onGLContextCreate = async (gl) => {
    const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;

    this.renderer = new CrossyRenderer({
      gl,
      antialias: true,
      width,
      height,
      clearColor: sceneColor,
    });

    this.unpause();
  };
}
