import os
import pygame

class Dashboard:
    def __init__(self):
        # We need to explicitly check if SDL_VIDEODRIVER is dummy, so we don't open
        # actual display if headless but try to otherwise.
        try:
            pygame.init()
            self.width = 1000
            self.height = 800
            self.screen = pygame.display.set_mode((self.width, self.height))
            pygame.display.set_caption("NEAT AI Dashboard")
            self.font = pygame.font.SysFont(None, 24)
            self.large_font = pygame.font.SysFont(None, 36)
            self.valid = True
        except Exception as e:
            print("Could not initialize pygame display:", e)
            self.valid = False

    def update(self, generation, best_fitness, avg_fitness, best_genome, config):
        if not self.valid:
            return False

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                self.valid = False
                return False

        self.screen.fill((30, 30, 30))

        # Draw stats
        gen_text = self.large_font.render(f"Generation: {generation}", True, (255, 255, 255))
        self.screen.blit(gen_text, (20, 20))

        fit_text = self.font.render(f"Best Fitness: {best_fitness:.2f}", True, (200, 255, 200))
        self.screen.blit(fit_text, (20, 60))

        if avg_fitness is not None:
            avg_text = self.font.render(f"Avg Fitness: {avg_fitness:.2f}", True, (200, 200, 255))
            self.screen.blit(avg_text, (20, 90))

        if best_genome and config:
            self.draw_network(best_genome, config)

        pygame.display.flip()
        return True

    def draw_network(self, genome, config):
        inputs = config.genome_config.input_keys
        outputs = config.genome_config.output_keys

        # Determine hidden nodes
        hidden = [k for k in genome.nodes.keys() if k not in inputs and k not in outputs]

        # Assign positions if not already done or if network changed
        y_offset = 150
        x_in = 100
        x_out = self.width - 100
        x_hidden = self.width // 2

        positions = {}
        input_spacing = min(30, (self.height - y_offset - 50) / max(1, len(inputs)))
        for i, node_id in enumerate(inputs):
            y = y_offset + (i * input_spacing)
            positions[node_id] = (x_in, y)

        output_spacing = min(100, (self.height - y_offset - 50) / max(1, len(outputs)))
        for i, node_id in enumerate(outputs):
            y = y_offset + (i * output_spacing)
            positions[node_id] = (x_out, y)

        if len(hidden) > 0:
            hidden_spacing = min(40, (self.height - y_offset - 50) / max(1, len(hidden)))
            for i, node_id in enumerate(hidden):
                y = y_offset + (i * hidden_spacing)
                positions[node_id] = (x_hidden, y)

        # Draw connections
        for cg in genome.connections.values():
            if cg.enabled:
                if cg.key[0] in positions and cg.key[1] in positions:
                    pos1 = positions[cg.key[0]]
                    pos2 = positions[cg.key[1]]
                    color = (0, 255, 0) if cg.weight > 0 else (255, 0, 0)
                    width = max(1, min(5, int(abs(cg.weight))))
                    pygame.draw.line(self.screen, color, pos1, pos2, width)

        # Draw nodes
        for node_id, pos in positions.items():
            color = (150, 150, 150)
            if node_id in inputs:
                color = (100, 200, 100)
            elif node_id in outputs:
                color = (100, 100, 200)
            pygame.draw.circle(self.screen, color, pos, 10)

            # Label
            label = self.font.render(str(node_id), True, (255, 255, 255))
            self.screen.blit(label, (int(pos[0]) - 10, int(pos[1]) - 25))
