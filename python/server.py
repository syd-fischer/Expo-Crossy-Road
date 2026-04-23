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
        self.current_genome = self.genomes[self.current_index] if len(self.genomes) > 0 else None
        self.net = neat.nn.FeedForwardNetwork.create(self.current_genome, self.config) if self.current_genome else None

        import configparser
        raw_config = configparser.ConfigParser()
        raw_config.read(CONFIG_PATH)
        self.stagnation_timeout = int(
            raw_config.get('GameSettings', 'stagnation_timeout', fallback='30')
        )
        self.move_interval = int(
            raw_config.get('GameSettings', 'move_interval', fallback='30')
        )

        self.dash = None
        # Handle headless environments safely
        if "SDL_VIDEODRIVER" not in os.environ:
            try:
                import pygame
                pygame.display.init()
                pygame.display.quit()
            except Exception:
                os.environ["SDL_VIDEODRIVER"] = "dummy"
                os.environ["SDL_AUDIODRIVER"] = "dummy"
                print("WARNING: Using dummy SDL video driver.")

    def init_dashboard(self):
        try:
            from dashboard_pygame import Dashboard
            self.dash = Dashboard()
        except Exception as e:
            print("Failed to initialize dashboard:", e)

    def update_dashboard(self):
        if self.dash is None:
            return

        best_fitness = 0
        avg_fitness = 0
        best_genome = getattr(self, 'current_genome', None)

        if hasattr(self, 'stats') and len(self.stats.most_fit_genomes) > 0:
            best_genome = self.stats.best_genome()
            best_fitness = best_genome.fitness if getattr(best_genome, 'fitness', None) is not None else 0

            fit_vals = [g.fitness for g in getattr(self, 'genomes', []) if getattr(g, 'fitness', None) is not None]
            if len(fit_vals) > 0:
                avg_fitness = sum(fit_vals) / len(fit_vals)
        elif hasattr(self, 'genomes') and len(self.genomes) > 0:
            fit_vals = [g.fitness if getattr(g, 'fitness', None) is not None else 0 for g in self.genomes]
            best_fitness = max(fit_vals) if len(fit_vals) > 0 else 0
            best_genome = sorted(self.genomes, key=lambda x: x.fitness if getattr(x, 'fitness', None) is not None else -float('inf'))[-1]
            if len(fit_vals) > 0:
                avg_fitness = sum(fit_vals) / len(fit_vals)

        self.dash.update(self.population.generation, best_fitness, avg_fitness, best_genome, self.config)

    def get_action(self, state: list[float]) -> str:
        if self.net is None:
            return 'UP'
        outputs = self.net.activate(state)
        actions = ['UP', 'DOWN', 'LEFT', 'RIGHT']
        return actions[outputs.index(max(outputs))]

    def score_current(self, fitness: float):
        if self.current_genome:
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
        self.current_genome = self.genomes[self.current_index] if len(self.genomes) > 0 else None
        if self.current_genome:
            self.net = neat.nn.FeedForwardNetwork.create(self.current_genome, self.config)
        else:
            self.net = None
        #self.visualize()
        if self.dash is None:
            self.init_dashboard()
        self.update_dashboard()

    def visualize(self):
        try:
            if self.current_genome:
                visualize.draw_net(self.config, self.current_genome, True)
            visualize.plot_stats(self.stats, ylog=False, view=True)
            visualize.plot_species(self.stats, view=True)
        except Exception as e:
            print(f"[Visualize] Skipped: {e}")

server = NEATServer()

async def handler(websocket):
    print("TS client connected")

    if server.dash is None:
        server.init_dashboard()
        server.update_dashboard()

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

            # Update UI on every frame requested
            if server.dash:
                server.update_dashboard()

        elif msg['type'] == 'generation_over':
            for i, fitness in enumerate(msg['fitnesses']):
                if i < len(server.genomes):
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
