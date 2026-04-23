import { swipeDirections } from '@/components/GestureView';

const ACTION_MAP: Record<string, string> = {
  UP:    swipeDirections.SWIPE_UP,
  DOWN:  swipeDirections.SWIPE_DOWN,
  LEFT:  swipeDirections.SWIPE_LEFT,
  RIGHT: swipeDirections.SWIPE_RIGHT,
};



export class MultiAIClient {
  private ws: WebSocket;
  private connected = false;
  private pendingActions: (string | null)[];
  moveInterval = 30;
  private ticks: number[];

  onReadyForNextGeneration?: () => void;
  onGenomeChange?: (generation: number) => void;
  onConfig?: (populationSize: number, stagnationTimeout: number, move_interval:number) => void;

  constructor(public populationSize: number) {
    this.pendingActions = Array(populationSize).fill(null);
    this.ticks = Array(populationSize).fill(0);

    this.ws = new WebSocket('ws://localhost:8765');
    this.ws.onopen  = () => {
      this.connected = true;
      console.log('[AI] Connected to Python NEAT server');
    };
    this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'config') {
            this.onConfig?.(msg.population_size, msg.stagnation_timeout, msg.move_interval);
        }
        else if (msg.type === 'actions') {
            msg.actions.forEach((action: string, i: number) => {
            this.pendingActions[i] = action;
            });
        } else if (msg.type === 'ready') {
            this.onGenomeChange?.(msg.generation);
            this.onReadyForNextGeneration?.();
        }
    };
    this.ws.onerror = (e) => console.error('[AI] WS error', e);
    this.ws.onclose = () => { this.connected = false; };
  }

  // Called once per tick for each living player
  tick(
    players: any[],
    gameMap: any,
    moveWithDirection: (playerIndex: number, dir: string) => void
  ) {
    if (!this.connected) return;

    // Collect states for all living players
    const states = players.map(p => this.buildInputs(p, gameMap));

    // Every moveInterval ticks, request new actions
    this.ticks[0]++;
    if (this.ticks[0] >= this.moveInterval) {
      this.ticks[0] = 0;
      this.ws.send(JSON.stringify({ type: 'get_actions', states }));
    }

    // Apply pending actions to each player
    players.forEach((player, i) => {
      if (!player.isAlive || player.moving) return;
      if (this.pendingActions[i]) {
        const dir = ACTION_MAP[this.pendingActions[i]!];
        this.pendingActions[i] = null;
        if (dir) moveWithDirection(i, dir);
      }
    });
  }

  sendGenerationOver(scores: number[], ticksAlive: number[]) {
    if (!this.connected) return;
    const fitnesses = scores.map((s, i) => s * 10 + ticksAlive[i] * 0.01);
    this.ws.send(JSON.stringify({ type: 'generation_over', fitnesses }));
  }

  resizePendingActions(size: number) {
    this.pendingActions = Array(size).fill(null);
    this.ticks = Array(size).fill(0);
    }

  buildInputs(hero: any, gameMap: any): number[] {
    // Same as AIClient.buildInputs — copy it here
    const inputs: number[] = [];
    inputs.push(hero.position.x / 5);
    inputs.push(hero.ridingOn ? 1 : 0);
    inputs.push(hero.ridingOn ? hero.ridingOn.speed / 0.08 : 0);
    inputs.push(hero.ridingOn ? (hero.ridingOn.dir ?? 0) : 0);
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
            minDist = dist; nearestSpeed = Math.abs(car.speed) / 0.08; nearestDir = car.dir;
          }
        }
        nearestOffset = minDist === Infinity ? 0 : minDist / 10;
      } else if (row.type === 'water') {
        const entities = row.entity.entities ?? [];
        let minDist = Infinity;
        for (const e of entities) {
          const dist = e.mesh.position.x - hero.position.x;
          if (Math.abs(dist) < Math.abs(minDist)) {
            minDist = dist; nearestSpeed = Math.abs(e.speed) / 0.08; nearestDir = e.dir ?? 0;
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
    return inputs;
  }
}