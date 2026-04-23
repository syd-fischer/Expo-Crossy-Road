export function buildSharedInputs(hero: any, gameMap: any): number[] {
  const inputs: number[] = [];
  const heroX = hero.position.x;
  const heroZ = Math.round(hero.position.z);

  // Helper to get row
  const getRow = (dz: number) => gameMap.getRow(heroZ + dz);

  // 1. Zone / Region Sensor (single binary)
  const currentRow = getRow(0);
  const isWaterZone = currentRow && currentRow.type === 'water' ? 1 : 0;
  inputs.push(isWaterZone);

  // Helper to detect threats in road/grass
  const checkThreat = (row: any, targetX: number): boolean => {
    if (!row) return false;
    if (row.type === 'road' || row.type === 'railRoad') {
      const cars = row.entity.cars || [];
      for (const car of cars) {
        if (Math.abs(car.mesh.position.x - targetX) < (car.collisionBox || 1.0)) {
          return true;
        }
      }
    } else if (row.type === 'water') {
        const entities = row.entity.entities || [];
        for (const e of entities) {
          if (Math.abs(e.mesh.position.x - targetX) < (e.collisionBox || 1.0)) {
             return false; // Logs are safe in water
          }
        }
        return true; // Empty water is a threat
    } else if (row.type === 'grass') {
        // Assume grass obstacles are in obstacleMap
        const blocked = row.entity.obstacleMap || {};
        const xRounded = Math.round(targetX);
        if (blocked[xRounded]) {
            return true; // Tree or boulder
        }
    }
    return false;
  };

  // 2. Front Obstacle / Threat Sensor
  let frontThreatLevel = 0;
  for (let dz = 1; dz <= 3; dz++) {
    const rowAhead = getRow(dz);
    if (rowAhead && checkThreat(rowAhead, heroX)) {
      if (dz === 1) frontThreatLevel = 1;
      else if (dz === 2) frontThreatLevel = 0.75;
      else if (dz === 3) frontThreatLevel = 0.5;
      break;
    }
  }
  // Let's implement more detailed obstacle finding

  const getNearestObstacleDist = (row: any, targetX: number, searchDir: number): number => {
      // searchDir -1 for left, 1 for right
      if (!row) return Infinity;
      let minOffset = Infinity;

      if (row.type === 'road' || row.type === 'railRoad') {
        const cars = row.entity.cars || [];
        for (const car of cars) {
            const carX = car.mesh.position.x;
            if ((searchDir === -1 && carX < targetX) || (searchDir === 1 && carX > targetX)) {
                // Approximate collision boundaries
                let dist = Math.abs(carX - targetX) - (car.collisionBox || 0.5);
                if (dist < minOffset) minOffset = dist;
            }
        }
      } else if (row.type === 'grass') {
          const blocked = row.entity.getBlockedPositions?.() || [];
          for (const bx of blocked) {
             if ((searchDir === -1 && bx < targetX) || (searchDir === 1 && bx > targetX)) {
                 let dist = Math.abs(bx - targetX) - 0.5;
                 if (dist < minOffset) minOffset = dist;
             }
          }
      } else if (row.type === 'water') {
           // Water is opposite, lack of entities is a threat. So threat is edge of current log or just 0 if no log
           // For sidestepping, threat is water without a log or lily pad.
      }
      return minOffset;
  };

  inputs.push(frontThreatLevel);

  // 3. Side-Left Obstacle
  let leftDist = getNearestObstacleDist(currentRow, heroX, -1);
  let sideLeftThreat = leftDist === Infinity ? 0 : Math.max(0, 1 - (leftDist / 5)); // Scaled 0-1, 1 is close
  if (isWaterZone && !hero.ridingOn) sideLeftThreat = 1; // Not riding = danger
  inputs.push(sideLeftThreat);

  // 4. Side-Right Obstacle
  let rightDist = getNearestObstacleDist(currentRow, heroX, 1);
  let sideRightThreat = rightDist === Infinity ? 0 : Math.max(0, 1 - (rightDist / 5));
  if (isWaterZone && !hero.ridingOn) sideRightThreat = 1;
  inputs.push(sideRightThreat);

  // 5. Diagonal Front-Left
  const rowFront1 = getRow(1);
  let diagLeftThreat = rowFront1 && checkThreat(rowFront1, heroX - 1) ? 1 : 0;
  inputs.push(diagLeftThreat);

  // 6. Diagonal Front-Right
  let diagRightThreat = rowFront1 && checkThreat(rowFront1, heroX + 1) ? 1 : 0;
  inputs.push(diagRightThreat);

  // 7 & 8. Log-Space Left & Log-Space Right
  let logSpaceLeft = 0;
  let logSpaceRight = 0;

  if (isWaterZone && hero.ridingOn) {
      const log = hero.ridingOn;
      const logX = log.mesh.position.x;
      const logWidth = log.width || 2; // Approximate if not set
      const logLeftEdge = logX - logWidth / 2;
      const logRightEdge = logX + logWidth / 2;

      // Available space to the left
      const spaceLeft = heroX - logLeftEdge;
      // Normalize, assuming max log size ~4 tiles
      logSpaceLeft = Math.max(0, Math.min(1, spaceLeft / 3));

      // Available space to the right
      const spaceRight = logRightEdge - heroX;
      logSpaceRight = Math.max(0, Math.min(1, spaceRight / 3));
  }
  inputs.push(logSpaceLeft, logSpaceRight);

  // 9. Front Log Sensor
  let frontLogSensor = 0;
  if (rowFront1 && rowFront1.type === 'water') {
      const entities = rowFront1.entity.entities || [];
      for (const e of entities) {
          const eX = e.mesh.position.x;
          const eWidth = e.collisionBox || (e.width / 2) || 1;
          if (Math.abs(eX - heroX) < eWidth) {
              frontLogSensor = 1;
              break;
          }
      }
  }
  inputs.push(frontLogSensor);

  // 10. Vertical Progress
  // Using an arbitrary max value like 100 for normalization
  const maxZ = 100;
  const verticalProgress = Math.max(0, Math.min(1, heroZ / maxZ));
  inputs.push(verticalProgress);

  // 11. Horizontal Position
  // Grid width is roughly -5 to 5, so map to 0-1
  const normalizedX = (heroX + 5) / 10;
  inputs.push(normalizedX);

  // 12. Obstacle Velocity
  let nearestSpeed = 0;
  // Check row ahead primarily, or current row
  let targetRowVel = rowFront1 || currentRow;
  if (targetRowVel) {
      if (targetRowVel.type === 'road' || targetRowVel.type === 'railRoad') {
          const cars = targetRowVel.entity.cars || [];
          let minDist = Infinity;
          for (const car of cars) {
              const dist = Math.abs(car.mesh.position.x - heroX);
              if (dist < minDist) {
                  minDist = dist;
                  nearestSpeed = (car.speed || 0) / 0.08;
              }
          }
      } else if (targetRowVel.type === 'water') {
          const entities = targetRowVel.entity.entities || [];
          let minDist = Infinity;
          for (const e of entities) {
              const dist = Math.abs(e.mesh.position.x - heroX);
              if (dist < minDist) {
                  minDist = dist;
                  nearestSpeed = (e.speed || 0) / 0.08;
              }
          }
      }
  }
  inputs.push(nearestSpeed);

  return inputs;
}
