import { swipeDirections } from '@/components/GestureView';
import { Genome } from './Genome';

const ACTIONS = [
  swipeDirections.SWIPE_UP,
  swipeDirections.SWIPE_DOWN,
  swipeDirections.SWIPE_LEFT,
  swipeDirections.SWIPE_RIGHT,
];

export class AIPlayer {
  genome: Genome;
  ticksSinceLastMove = 0;
  moveInterval = 30; // frames between moves — tune this

  constructor(genome: Genome) {
    this.genome = genome;
  }

  // Build the 22-value input vector from live game state
  buildInputs(hero, gameMap): number[] {
    const inputs: number[] = [];

    // Player state
    inputs.push(hero.position.x / 5);
    inputs.push(hero.ridingOn ? 1 : 0);
    inputs.push(hero.ridingOn ? hero.ridingOn.speed / 0.08 : 0);
    inputs.push(hero.ridingOn ? hero.ridingOn.dir : 0);

    // 5 rows ahead
    for (let dz = 0; dz < 5; dz++) {
      const rowZ = Math.round(hero.position.z) + dz;
      const row = gameMap.getRow(rowZ);

      if (!row) {
        inputs.push(0, 0, 0, 0);
        continue;
      }

      const typeVal = row.type === 'grass' ? 0 : row.type === 'water' ? 1 : 0.5;
      inputs.push(typeVal);

      // Find nearest threat X offset from player
      let nearestOffset = 0;
      let nearestSpeed = 0;
      let nearestDir = 0;

      if (row.type === 'road' || row.type === 'railRoad') {
        const cars = row.entity.cars || [];
        let minDist = Infinity;
        for (const car of cars) {
          const dist = car.mesh.position.x - hero.position.x;
          if (Math.abs(dist) < Math.abs(minDist)) {
            minDist = dist;
            nearestSpeed = Math.abs(car.speed) / 0.08;
            nearestDir = car.dir;
          }
        }
        nearestOffset = minDist / 10; // normalize to ~[-1, 1]
      } else if (row.type === 'water') {
        const entities = row.entity.entities || [];
        let minDist = Infinity;
        for (const e of entities) {
          const dist = e.mesh.position.x - hero.position.x;
          if (Math.abs(dist) < Math.abs(minDist)) {
            minDist = dist;
            nearestSpeed = Math.abs(e.speed) / 0.08;
            nearestDir = e.dir;
          }
        }
        nearestOffset = minDist / 10;
      } else if (row.type === 'grass') {
        // Nearest tree/obstacle
        const blocked = row.entity.getBlockedPositions();
        let minDist = Infinity;
        for (const bx of blocked) {
          const dist = bx - hero.position.x;
          if (Math.abs(dist) < Math.abs(minDist)) minDist = dist;
        }
        nearestOffset = minDist === Infinity ? 0 : minDist / 5;
      }

      inputs.push(nearestOffset, nearestSpeed, nearestDir);
    }

    return inputs; // length = 4 + 5*4 = 24... adjust INPUT_COUNT to 24 in NEAT.ts
  }

  // Called every tick from GameEngine
  tick(hero, gameMap, moveWithDirection: (dir: string) => void) {
    if (!hero.isAlive || hero.moving) return;

    this.ticksSinceLastMove++;
    if (this.ticksSinceLastMove < this.moveInterval) return;
    this.ticksSinceLastMove = 0;

    const inputs = this.buildInputs(hero, gameMap);
    const outputs = this.genome.activate(inputs);

    // Pick highest-activation output
    const bestIndex = outputs.indexOf(Math.max(...outputs));
    moveWithDirection(ACTIONS[bestIndex]);
  }

  // Fitness = how far forward the player got + survival time bonus
  computeFitness(score: number, ticksAlive: number): number {
    this.genome.fitness = score * 10 + ticksAlive * 0.01;
    return this.genome.fitness;
  }
}