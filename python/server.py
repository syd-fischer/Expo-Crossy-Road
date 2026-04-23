import asyncio
import json
import websockets
import neat
import os
import visualize  # neat-python helper for graphviz diagrams

CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'neat_config.txt')

class NEATServer:
    def __init__(self):
        
        self.config = neat.Config(
            neat.DefaultGenome,
            neat.DefaultReproduction,
            neat.DefaultSpeciesSet,
            neat.DefaultStagnation,
            CONFIG_PATH,
        )
        self.population = neat.Population(self.config)
        self.population.add_reporter(neat.StdOutReporter(True))
        self.stats = neat.StatisticsReporter()
        self.population.add_reporter(self.stats)

        # Flatten population dict to a list for sequential play
        self.genomes = list(self.population.population.values())
        self.nets = [
            neat.nn.FeedForwardNetwork.create(g, self.config)
            for g in self.genomes
        ]
        self.current_index = 0
        self.current_genome = self.genomes[self.current_index]
        self.net = neat.nn.FeedForwardNetwork.create(self.current_genome, self.config)

        import configparser
        raw_config = configparser.ConfigParser()
        raw_config.read(CONFIG_PATH)
        self.stagnation_timeout = int(
            raw_config.get('GameSettings', 'stagnation_timeout', fallback='30')
        )
        self.move_interval = int(
            raw_config.get('GameSettings', 'move_interval', fallback='30')
        )

    def get_action(self, state: list[float]) -> str:
        outputs = self.net.activate(state)
        actions = ['UP', 'DOWN', 'LEFT', 'RIGHT']
        return actions[outputs.index(max(outputs))]

    def score_current(self, fitness: float):
        self.current_genome.fitness = fitness
        print(f"Genome {self.current_index} scored: {fitness:.2f}")

    def advance(self) -> bool:
        """Move to next genome. Returns True if generation is complete."""
        self.current_index += 1
        if self.current_index >= len(self.genomes):
            return True  # generation done
        self.current_genome = self.genomes[self.current_index]
        self.net = neat.nn.FeedForwardNetwork.create(self.current_genome, self.config)
        return False

    def evolve(self):
        """Run one generation of evolution and reset."""
        # neat-python evolve requires a fitness function — we've already set fitness manually
        self.population.run(lambda genomes, config: None, 1)
        self.genomes = list(self.population.population.values())
        self.current_index = 0
        self.current_genome = self.genomes[self.current_index]
        self.net = neat.nn.FeedForwardNetwork.create(self.current_genome, self.config)
        #self.visualize()

    def visualize(self):
        try:
            visualize.draw_net(self.config, self.current_genome, True)
            visualize.plot_stats(self.stats, ylog=False, view=True)
            visualize.plot_species(self.stats, view=True)
        except Exception as e:
            print(f"[Visualize] Skipped: {e}")

server = NEATServer()

async def handler(websocket):
    print("TS client connected")

    # Use global server instance, not self
    await websocket.send(json.dumps({
        'type': 'config',
        'population_size': len(server.genomes),
        'stagnation_timeout': server.stagnation_timeout,  # ← server. not self.
        'move_interval': server.move_interval,
    }))

    async for raw in websocket:
        msg = json.loads(raw)

        if msg['type'] == 'get_actions':
            actions = []
            for i, state in enumerate(msg['states']):
                outputs = server.nets[i].activate(state)
                action_names = ['UP', 'DOWN', 'LEFT', 'RIGHT']
                actions.append(action_names[outputs.index(max(outputs))])
            await websocket.send(json.dumps({
                'type': 'actions',
                'actions': actions,
            }))

        elif msg['type'] == 'generation_over':
            for i, fitness in enumerate(msg['fitnesses']):
                server.genomes[i].fitness = fitness
                print(f"  Genome {i} fitness: {fitness:.2f}")
            server.evolve()
            await websocket.send(json.dumps({
                'type': 'ready',
                'generation': server.population.generation,
            }))

async def main():
    print("NEAT server running on ws://localhost:8765")
    async with websockets.serve(handler, 'localhost', 8765):
        await asyncio.Future()  # run forever

asyncio.run(main())