import { Genome } from './Genome';

export class NEAT {
  population: Genome[] = [];
  generation = 0;
  innovation = { next: 0 };
  INPUT_COUNT = 22;
  OUTPUT_COUNT = 4;

  constructor(public populationSize: number) {
    for (let i = 0; i < populationSize; i++) {
      const g = Genome.createMinimal(this.INPUT_COUNT, this.OUTPUT_COUNT, this.innovation);
      this.population.push(g);
    }
  }

  // Call after all genomes in this generation have played
  evolve() {
    this.population.sort((a, b) => b.fitness - a.fitness);

    const [best, ...rest] = this.population;
    console.log(`Generation ${this.generation} | Best fitness: ${best.fitness}`);

    const nextGen: Genome[] = [];

    // Elitism: keep the best genome unchanged
    nextGen.push(best);

    // Fill the rest with mutated offspring of the best
    while (nextGen.length < this.populationSize) {
      const parent1 = this.population[0]; // best
      const parent2 = this.population[Math.floor(Math.random() * this.population.length)];
      const winner = parent1.fitness >= parent2.fitness ? parent1 : parent2;
      const loser  = winner === parent1 ? parent2 : parent1;
      const child  = Genome.crossover(winner, loser);
      child.mutate(this.innovation);
      nextGen.push(child);
    }

    this.population = nextGen;
    this.generation++;
  }
}