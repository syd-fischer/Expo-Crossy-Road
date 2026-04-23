import { swipeDirections } from '@/components/GestureView';

const ACTION_MAP: Record<string, string> = {
  UP:    swipeDirections.SWIPE_UP,
  DOWN:  swipeDirections.SWIPE_DOWN,
  LEFT:  swipeDirections.SWIPE_LEFT,
  RIGHT: swipeDirections.SWIPE_RIGHT,
};

export class AIClient {
  private ws: WebSocket;
  private pendingAction: string | null = null;
  private connected = false;
  ticksSinceLastMove = 0;
  moveInterval = 30;

  onGenomeChange?: (generation: number, index: number) => void;
  onReadyForNextGenome?: () => void;

  constructor() {
    this.ws = new WebSocket('ws://localhost:8765');
    this.ws.onopen  = () => {
      this.connected = true;
      console.log('[AI] Connected to Python NEAT server');
    };
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'action') {
        this.pendingAction = msg.action;
      } else if (msg.type === 'ready') {
        this.onGenomeChange?.(msg.generation, msg.genome_index);
        this.onReadyForNextGenome?.();
      }
    };
    this.ws.onerror = (e) => console.error('[AI] WS error', e);
    this.ws.onclose = () => { this.connected = false; };
  }

  buildInputs(hero: any, gameMap: any): number[] {
    const inputs: number[] = [];

    // Player state (4 values)
    inputs.push(hero.position.x / 5);
    inputs.push(hero.ridingOn ? 1 : 0);
    inputs.push(hero.ridingOn ? hero.ridingOn.speed / 0.08 : 0);
    inputs.push(hero.ridingOn ? (hero.ridingOn.dir ?? 0) : 0);

    // 5 rows ahead (5 × 4 = 20 values)
    for (let dz = 0; dz < 5; dz++) {
      const rowZ = Math.round(hero.position.z) + dz;
      const row = gameMap.getRow(rowZ);

      if (!row) { inputs.push(0, 0, 0, 0); continue; }

      const typeVal = row.type === 'grass' ? 0 : row.type === 'water' ? 1 : 0.5;
      inputs.push(typeVal);

      let nearestOffset = 0, nearestSpeed = 0, nearestDir = 0;

      if (row.type === 'road' || row.type === 'railRoad') {
        const cars = row.entity.cars ?? [];
        let minDist = Infinity;
        for (const car of cars) {
          const dist = car.mesh.position.x - hero.position.x;
          if (Math.abs(dist) < Math.abs(minDist)) {
            minDist = dist;
            nearestSpeed = Math.abs(car.speed) / 0.08;
            nearestDir = car.dir;
          }
        }
        nearestOffset = minDist === Infinity ? 0 : minDist / 10;
      } else if (row.type === 'water') {
        const entities = row.entity.entities ?? [];
        let minDist = Infinity;
        for (const e of entities) {
          const dist = e.mesh.position.x - hero.position.x;
          if (Math.abs(dist) < Math.abs(minDist)) {
            minDist = dist;
            nearestSpeed = Math.abs(e.speed) / 0.08;
            nearestDir = e.dir ?? 0;
          }
        }
        nearestOffset = minDist === Infinity ? 0 : minDist / 10;
      } else if (row.type === 'grass') {
        const blocked = row.entity.getBlockedPositions?.() ?? [];
        let minDist = Infinity;
        for (const bx of blocked) {
          const dist = bx - hero.position.x;
          if (Math.abs(dist) < Math.abs(minDist)) minDist = dist;
        }
        nearestOffset = minDist === Infinity ? 0 : minDist / 5;
      }

      inputs.push(nearestOffset, nearestSpeed, nearestDir);
    }

    return inputs; // 24 values total
  }

  tick(hero: any, gameMap: any, moveWithDirection: (dir: string) => void) {
    if (!hero.isAlive || hero.moving || !this.connected) return;

    this.ticksSinceLastMove++;
    if (this.ticksSinceLastMove >= this.moveInterval) {
      this.ticksSinceLastMove = 0;
      const state = this.buildInputs(hero, gameMap);
      this.ws.send(JSON.stringify({ type: 'get_action', state }));
    }

    if (this.pendingAction) {
      const dir = ACTION_MAP[this.pendingAction];
      this.pendingAction = null;
      if (dir) moveWithDirection(dir);
    }
  }

  sendGameOver(score: number, ticksAlive: number) {
    if (!this.connected) return;
    const fitness = score * 10 + ticksAlive * 0.01;
    this.ws.send(JSON.stringify({ type: 'game_over', fitness }));
  }
}