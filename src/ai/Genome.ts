// Encodes a neural network as a list of connection genes
export type NodeGene = { id: number; type: 'input' | 'hidden' | 'output' };
export type ConnectionGene = {
  in: number;
  out: number;
  weight: number;
  enabled: boolean;
  innovation: number;
};

export class Genome {
  nodes: NodeGene[] = [];
  connections: ConnectionGene[] = [];
  fitness = 0;

  constructor(public inputCount: number, public outputCount: number) {
    // Create input + output nodes
    for (let i = 0; i < inputCount; i++)
      this.nodes.push({ id: i, type: 'input' });
    for (let i = 0; i < outputCount; i++)
      this.nodes.push({ id: inputCount + i, type: 'output' });
  }

  // Feed-forward activation
  activate(inputs: number[]): number[] {
    const values: Record<number, number> = {};

    // Set input values
    for (let i = 0; i < this.inputCount; i++) values[i] = inputs[i];

    // Activate each output by summing enabled connections
    const outputIds = this.nodes
      .filter(n => n.type === 'output')
      .map(n => n.id);

    const activate = (nodeId: number): number => {
      if (values[nodeId] !== undefined) return values[nodeId];
      const incoming = this.connections.filter(
        c => c.out === nodeId && c.enabled
      );
      const sum = incoming.reduce(
        (acc, c) => acc + activate(c.in) * c.weight, 0
      );
      values[nodeId] = Math.tanh(sum); // tanh activation
      return values[nodeId];
    };

    return outputIds.map(id => activate(id));
  }

  // Mutate: perturb weights or add a connection
  mutate(innovationCounter: { next: number }) {
    // 80% chance: perturb all weights
    if (Math.random() < 0.8) {
      for (const c of this.connections) {
        if (Math.random() < 0.9) {
          c.weight += (Math.random() * 2 - 1) * 0.1; // nudge
        } else {
          c.weight = Math.random() * 4 - 2; // reset
        }
      }
    }

    // 5% chance: add a new connection between two unconnected nodes
    if (Math.random() < 0.05) {
      const from = this.nodes[Math.floor(Math.random() * this.nodes.length)];
      const to = this.nodes.filter(n => n.type !== 'input')[
        Math.floor(Math.random() * this.nodes.filter(n => n.type !== 'input').length)
      ];
      const exists = this.connections.some(c => c.in === from.id && c.out === to.id);
      if (!exists) {
        this.connections.push({
          in: from.id,
          out: to.id,
          weight: Math.random() * 4 - 2,
          enabled: true,
          innovation: innovationCounter.next++,
        });
      }
    }
  }

  // Crossover: combine two genomes (winner = higher fitness)
  static crossover(winner: Genome, loser: Genome): Genome {
    const child = new Genome(winner.inputCount, winner.outputCount);
    child.nodes = [...winner.nodes];
    child.connections = winner.connections.map(wc => {
      const matching = loser.connections.find(lc => lc.innovation === wc.innovation);
      return {
        ...wc,
        // If both parents have the gene, randomly pick which weight to use
        weight: matching ? (Math.random() < 0.5 ? wc.weight : matching.weight) : wc.weight,
        // Disable if either parent has it disabled
        enabled: wc.enabled && (matching ? matching.enabled : true),
      };
    });
    return child;
  }

  static createMinimal(inputCount: number, outputCount: number, innovation: { next: number }): Genome {
    const g = new Genome(inputCount, outputCount);
    // Connect every input to every output with random weights
    for (let i = 0; i < inputCount; i++) {
      for (let o = 0; o < outputCount; o++) {
        g.connections.push({
          in: i,
          out: inputCount + o,
          weight: Math.random() * 4 - 2,
          enabled: true,
          innovation: innovation.next++,
        });
      }
    }
    return g;
  }
}