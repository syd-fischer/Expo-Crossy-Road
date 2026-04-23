const NUM_ENTITIES = 1000;
const ITERATIONS = 10000;

class MockEntity {
  mesh: any = {};
}

let entities: any[] = [];
for (let i = 0; i < NUM_ENTITIES; i++) {
  entities.push(new MockEntity());
}

const mockFloor = {
  remove: (mesh: any) => {}
};

function testMap() {
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    entities.map((val) => {
      mockFloor.remove(val.mesh);
      val = null;
    });
  }
  return performance.now() - start;
}

function testForEach() {
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    entities.forEach((val) => {
      mockFloor.remove(val.mesh);
      val = null;
    });
  }
  return performance.now() - start;
}

function testForOf() {
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    for (const val of entities) {
      mockFloor.remove(val.mesh);
      // val = null; not reassignable, but we don't need it anyway since it was a local ref
    }
  }
  return performance.now() - start;
}

function testFor() {
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    for (let j = 0; j < entities.length; j++) {
      mockFloor.remove(entities[j].mesh);
    }
  }
  return performance.now() - start;
}

console.log(`Array.map(): ${testMap()} ms`);
console.log(`Array.forEach(): ${testForEach()} ms`);
console.log(`for...of loop: ${testForOf()} ms`);
console.log(`for loop: ${testFor()} ms`);
