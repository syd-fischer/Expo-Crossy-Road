import { swipeDirections } from '@/components/GestureView';
import { Genome } from './Genome';
import { buildSharedInputs } from './SharedInputs';

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

  buildInputs(hero, gameMap): number[] {
    return buildSharedInputs(hero, gameMap);
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