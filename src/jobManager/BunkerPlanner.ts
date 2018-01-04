export class BunkerPlanner {
  /**
   * RCL 8: http://short.dissi.me/WzjB1n
   * RCL 7: http://short.dissi.me/VZkBJo
   * RCL 6: http://short.dissi.me/8gbxDb
   * RCL 5: http://short.dissi.me/aA6oex
   * RCL 4: http://short.dissi.me/D8QeYK
   * RCL 3: http://short.dissi.me/o78aw0
   * RCL 2: http://short.dissi.me/eXxa44
   *
   */
  public rcl8 = {buildings: {rampart: {pos: [{x: 5, y: 0}, {x: 6, y: 0}, {x: 7, y: 0}, {x: 8, y: 0}, {x: 9, y: 0}, {x: 5, y: 1}, {x: 9, y: 1}, {x: 2, y: 2}, {x: 3, y: 2}, {x: 4, y: 2}, {x: 5, y: 2}, {x: 9, y: 2}, {x: 10, y: 2}, {x: 11, y: 2}, {x: 12, y: 2}, {x: 13, y: 2}, {x: 14, y: 2}, {x: 1, y: 3}, {x: 2, y: 3}, {x: 14, y: 3}, {x: 15, y: 3}, {x: 0, y: 4}, {x: 1, y: 4}, {x: 15, y: 4}, {x: 16, y: 4}, {x: 0, y: 5}, {x: 16, y: 5}, {x: 0, y: 6}, {x: 16, y: 6}, {x: 0, y: 7}, {x: 16, y: 7}, {x: 0, y: 8}, {x: 1, y: 8}, {x: 15, y: 8}, {x: 16, y: 8}, {x: 1, y: 9}, {x: 2, y: 9}, {x: 14, y: 9}, {x: 15, y: 9}, {x: 2, y: 10}, {x: 3, y: 10}, {x: 4, y: 10}, {x: 12, y: 10}, {x: 13, y: 10}, {x: 14, y: 10}, {x: 4, y: 11}, {x: 12, y: 11}, {x: 4, y: 12}, {x: 5, y: 12}, {x: 11, y: 12}, {x: 12, y: 12}, {x: 5, y: 13}, {x: 6, y: 13}, {x: 10, y: 13}, {x: 11, y: 13}, {x: 6, y: 14}, {x: 7, y: 14}, {x: 8, y: 14}, {x: 9, y: 14}, {x: 10, y: 14}]}, road: {pos: [{x: 6, y: 1}, {x: 7, y: 2}, {x: 5, y: 3}, {x: 8, y: 3}, {x: 9, y: 3}, {x: 10, y: 3}, {x: 11, y: 3}, {x: 4, y: 4}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 12, y: 4}, {x: 3, y: 5}, {x: 7, y: 5}, {x: 9, y: 5}, {x: 10, y: 5}, {x: 13, y: 5}, {x: 2, y: 6}, {x: 7, y: 6}, {x: 9, y: 6}, {x: 11, y: 6}, {x: 14, y: 6}, {x: 3, y: 7}, {x: 6, y: 7}, {x: 8, y: 7}, {x: 9, y: 7}, {x: 13, y: 7}, {x: 4, y: 8}, {x: 6, y: 8}, {x: 10, y: 8}, {x: 12, y: 8}, {x: 5, y: 9}, {x: 11, y: 9}, {x: 6, y: 10}, {x: 10, y: 10}, {x: 7, y: 11}, {x: 9, y: 11}, {x: 8, y: 12}]}, lab: {pos: [{x: 7, y: 1}, {x: 8, y: 1}, {x: 6, y: 2}, {x: 8, y: 2}, {x: 6, y: 3}, {x: 7, y: 3}]}, extension: {pos: [{x: 3, y: 3}, {x: 4, y: 3}, {x: 12, y: 3}, {x: 13, y: 3}, {x: 2, y: 4}, {x: 3, y: 4}, {x: 5, y: 4}, {x: 11, y: 4}, {x: 13, y: 4}, {x: 14, y: 4}, {x: 1, y: 5}, {x: 2, y: 5}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 11, y: 5}, {x: 12, y: 5}, {x: 14, y: 5}, {x: 15, y: 5}, {x: 1, y: 6}, {x: 4, y: 6}, {x: 13, y: 6}, {x: 15, y: 6}, {x: 1, y: 7}, {x: 2, y: 7}, {x: 4, y: 7}, {x: 5, y: 7}, {x: 11, y: 7}, {x: 12, y: 7}, {x: 14, y: 7}, {x: 15, y: 7}, {x: 2, y: 8}, {x: 3, y: 8}, {x: 5, y: 8}, {x: 11, y: 8}, {x: 13, y: 8}, {x: 14, y: 8}, {x: 3, y: 9}, {x: 4, y: 9}, {x: 6, y: 9}, {x: 7, y: 9}, {x: 9, y: 9}, {x: 10, y: 9}, {x: 12, y: 9}, {x: 13, y: 9}, {x: 5, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 11, y: 10}, {x: 5, y: 11}, {x: 6, y: 11}, {x: 10, y: 11}, {x: 11, y: 11}, {x: 6, y: 12}, {x: 7, y: 12}, {x: 9, y: 12}, {x: 10, y: 12}, {x: 7, y: 13}, {x: 8, y: 13}, {x: 9, y: 13}]}, spawn: {pos: [{x: 8, y: 4}, {x: 9, y: 4}, {x: 10, y: 4}]}, powerSpawn: {pos: [{x: 6, y: 5}]}, tower: {pos: [{x: 8, y: 5}, {x: 7, y: 7}, {x: 10, y: 7}, {x: 7, y: 8}, {x: 8, y: 8}, {x: 9, y: 8}]}, link: {pos: [{x: 3, y: 6}, {x: 12, y: 6}, {x: 8, y: 11}]}, observer: {pos: [{x: 5, y: 6}]}, nuker: {pos: [{x: 6, y: 6}]}, terminal: {pos: [{x: 8, y: 6}]}, storage: {pos: [{x: 10, y: 6}]}}};
  public rcl7 = {buildings: {lab: {pos: [{x: 7, y: 1}, {x: 8, y: 1}, {x: 6, y: 2}, {x: 8, y: 2}, {x: 6, y: 3}, {x: 7, y: 3}]}, road: {pos: [{x: 7, y: 2}, {x: 5, y: 3}, {x: 8, y: 3}, {x: 9, y: 3}, {x: 10, y: 3}, {x: 11, y: 3}, {x: 6, y: 4}, {x: 7, y: 4}, {x: 10, y: 4}, {x: 12, y: 4}, {x: 6, y: 5}, {x: 7, y: 5}, {x: 9, y: 5}, {x: 10, y: 5}, {x: 13, y: 5}, {x: 5, y: 6}, {x: 7, y: 6}, {x: 9, y: 6}, {x: 11, y: 6}, {x: 14, y: 6}, {x: 3, y: 7}, {x: 6, y: 7}, {x: 9, y: 7}, {x: 13, y: 7}, {x: 4, y: 8}, {x: 6, y: 8}, {x: 7, y: 8}, {x: 10, y: 8}, {x: 12, y: 8}, {x: 5, y: 9}, {x: 8, y: 9}, {x: 11, y: 9}, {x: 6, y: 10}, {x: 10, y: 10}, {x: 7, y: 11}, {x: 9, y: 11}, {x: 8, y: 12}]}, extension: {pos: [{x: 12, y: 3}, {x: 13, y: 3}, {x: 5, y: 4}, {x: 11, y: 4}, {x: 13, y: 4}, {x: 14, y: 4}, {x: 4, y: 5}, {x: 5, y: 5}, {x: 11, y: 5}, {x: 12, y: 5}, {x: 14, y: 5}, {x: 15, y: 5}, {x: 4, y: 6}, {x: 13, y: 6}, {x: 15, y: 6}, {x: 4, y: 7}, {x: 5, y: 7}, {x: 11, y: 7}, {x: 12, y: 7}, {x: 14, y: 7}, {x: 15, y: 7}, {x: 3, y: 8}, {x: 5, y: 8}, {x: 11, y: 8}, {x: 13, y: 8}, {x: 14, y: 8}, {x: 3, y: 9}, {x: 4, y: 9}, {x: 6, y: 9}, {x: 7, y: 9}, {x: 9, y: 9}, {x: 10, y: 9}, {x: 12, y: 9}, {x: 13, y: 9}, {x: 5, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 11, y: 10}, {x: 5, y: 11}, {x: 6, y: 11}, {x: 10, y: 11}, {x: 11, y: 11}, {x: 6, y: 12}, {x: 7, y: 12}, {x: 9, y: 12}, {x: 10, y: 12}, {x: 7, y: 13}, {x: 8, y: 13}, {x: 9, y: 13}]}, spawn: {pos: [{x: 8, y: 4}, {x: 9, y: 4}]}, tower: {pos: [{x: 8, y: 5}, {x: 10, y: 7}, {x: 9, y: 8}]}, terminal: {pos: [{x: 8, y: 6}]}, storage: {pos: [{x: 10, y: 6}]}, link: {pos: [{x: 12, y: 6}, {x: 8, y: 11}]}}};
  public rcl6 = {buildings: {lab: {pos: [{x: 6, y: 2}, {x: 6, y: 3}, {x: 7, y: 3}]}, road: {pos: [{x: 7, y: 2}, {x: 8, y: 3}, {x: 9, y: 3}, {x: 10, y: 3}, {x: 11, y: 3}, {x: 7, y: 4}, {x: 8, y: 4}, {x: 10, y: 4}, {x: 12, y: 4}, {x: 7, y: 5}, {x: 9, y: 5}, {x: 10, y: 5}, {x: 13, y: 5}, {x: 9, y: 6}, {x: 11, y: 6}, {x: 14, y: 6}, {x: 9, y: 7}, {x: 13, y: 7}, {x: 6, y: 8}, {x: 7, y: 8}, {x: 9, y: 8}, {x: 10, y: 8}, {x: 12, y: 8}, {x: 5, y: 9}, {x: 8, y: 9}, {x: 11, y: 9}, {x: 6, y: 10}, {x: 10, y: 10}, {x: 7, y: 11}, {x: 9, y: 11}, {x: 8, y: 12}]}, extension: {pos: [{x: 12, y: 3}, {x: 13, y: 3}, {x: 11, y: 4}, {x: 13, y: 4}, {x: 14, y: 4}, {x: 11, y: 5}, {x: 12, y: 5}, {x: 14, y: 5}, {x: 15, y: 5}, {x: 13, y: 6}, {x: 15, y: 6}, {x: 11, y: 7}, {x: 12, y: 7}, {x: 14, y: 7}, {x: 15, y: 7}, {x: 11, y: 8}, {x: 13, y: 8}, {x: 14, y: 8}, {x: 6, y: 9}, {x: 7, y: 9}, {x: 9, y: 9}, {x: 10, y: 9}, {x: 12, y: 9}, {x: 13, y: 9}, {x: 5, y: 10}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 11, y: 10}, {x: 5, y: 11}, {x: 6, y: 11}, {x: 10, y: 11}, {x: 11, y: 11}, {x: 6, y: 12}, {x: 7, y: 12}, {x: 9, y: 12}, {x: 10, y: 12}, {x: 7, y: 13}, {x: 8, y: 13}, {x: 9, y: 13}]}, spawn: {pos: [{x: 9, y: 4}]}, tower: {pos: [{x: 8, y: 5}, {x: 10, y: 7}]}, terminal: {pos: [{x: 8, y: 6}]}, storage: {pos: [{x: 10, y: 6}]}, link: {pos: [{x: 12, y: 6}]}}};
  public rcl5 = {buildings: {road: {pos: [{x: 9, y: 3}, {x: 10, y: 3}, {x: 11, y: 3}, {x: 10, y: 4}, {x: 12, y: 4}, {x: 9, y: 5}, {x: 10, y: 5}, {x: 13, y: 5}, {x: 9, y: 6}, {x: 11, y: 6}, {x: 14, y: 6}, {x: 9, y: 7}, {x: 13, y: 7}, {x: 6, y: 8}, {x: 7, y: 8}, {x: 9, y: 8}, {x: 10, y: 8}, {x: 12, y: 8}, {x: 5, y: 9}, {x: 8, y: 9}, {x: 11, y: 9}, {x: 6, y: 10}, {x: 10, y: 10}, {x: 7, y: 11}, {x: 9, y: 11}, {x: 8, y: 12}]}, extension: {pos: [{x: 12, y: 3}, {x: 13, y: 3}, {x: 11, y: 4}, {x: 13, y: 4}, {x: 14, y: 4}, {x: 11, y: 5}, {x: 12, y: 5}, {x: 14, y: 5}, {x: 15, y: 5}, {x: 13, y: 6}, {x: 15, y: 6}, {x: 11, y: 7}, {x: 12, y: 7}, {x: 14, y: 7}, {x: 15, y: 7}, {x: 11, y: 8}, {x: 13, y: 8}, {x: 14, y: 8}, {x: 6, y: 9}, {x: 7, y: 9}, {x: 9, y: 9}, {x: 10, y: 9}, {x: 12, y: 9}, {x: 13, y: 9}, {x: 7, y: 10}, {x: 8, y: 10}, {x: 9, y: 10}, {x: 11, y: 10}, {x: 10, y: 11}, {x: 11, y: 11}]}, spawn: {pos: [{x: 9, y: 4}]}, tower: {pos: [{x: 8, y: 5}, {x: 10, y: 7}]}, storage: {pos: [{x: 10, y: 6}]}, link: {pos: [{x: 12, y: 6}]}}};
  public rcl4 = {buildings: {road: {pos: [{x: 9, y: 3}, {x: 10, y: 3}, {x: 11, y: 3}, {x: 10, y: 4}, {x: 12, y: 4}, {x: 10, y: 5}, {x: 13, y: 5}, {x: 11, y: 6}, {x: 12, y: 6}, {x: 14, y: 6}, {x: 13, y: 7}, {x: 12, y: 8}, {x: 11, y: 9}]}, extension: {pos: [{x: 12, y: 3}, {x: 13, y: 3}, {x: 11, y: 4}, {x: 13, y: 4}, {x: 14, y: 4}, {x: 11, y: 5}, {x: 12, y: 5}, {x: 14, y: 5}, {x: 15, y: 5}, {x: 13, y: 6}, {x: 15, y: 6}, {x: 11, y: 7}, {x: 12, y: 7}, {x: 14, y: 7}, {x: 15, y: 7}, {x: 11, y: 8}, {x: 13, y: 8}, {x: 14, y: 8}, {x: 12, y: 9}, {x: 13, y: 9}]}, spawn: {pos: [{x: 9, y: 4}]}, storage: {pos: [{x: 10, y: 6}]}, tower: {pos: [{x: 10, y: 7}]}}};
  public rcl3 = {buildings: {road: {pos: [{x: 9, y: 3}, {x: 10, y: 3}, {x: 11, y: 3}, {x: 10, y: 4}, {x: 12, y: 4}, {x: 10, y: 5}, {x: 13, y: 5}, {x: 11, y: 6}, {x: 12, y: 6}]}, extension: {pos: [{x: 12, y: 3}, {x: 13, y: 3}, {x: 11, y: 4}, {x: 13, y: 4}, {x: 14, y: 4}, {x: 11, y: 5}, {x: 12, y: 5}, {x: 13, y: 6}, {x: 11, y: 7}, {x: 12, y: 7}]}, spawn: {pos: [{x: 9, y: 4}]}, tower: {pos: [{x: 10, y: 7}]}}};
  public rcl2 = {buildings: {road: {pos: [{x: 9, y: 3}, {x: 10, y: 3}, {x: 11, y: 3}, {x: 12, y: 4}, {x: 13, y: 5}]}, extension: {pos: [{x: 12, y: 3}, {x: 13, y: 3}, {x: 11, y: 4}, {x: 11, y: 5}, {x: 12, y: 5}]}, spawn: {pos: [{x: 9, y: 4}]}}};

  public room: Room;
  public size: {x: number, y: number};
  constructor(room: Room) {
    this.room = room;
    this.setSizeBunker();
  }

  /**
   * immer erst SPALTE=X DANN ZEILE = Y
   */
  public run() {
    const placeable = this.placeAblePositions();
    console.log(placeable);
    for (let i = 0; i < 49; i++) {
      for (let j = 0; j < 49; j++) {
        if ( placeable.get(i, j) === 0) {
          this.room.visual.circle(i, j);
        }
      }
    }
  }

  public placeAblePositions() {
    const matrix = new PathFinder.CostMatrix();
    const bunker = this.bunker2Matrix();
    const roomMatrix = this.room2Matrix();
    for (let i = 0; i < 49; i++) {
      for (let j = 0; j < 49; j++) {
        if (this.bunkerPlaceableAt(bunker, roomMatrix, i, j)) {
          matrix.set(i, j, 0);
        } else {
          matrix.set(i, j, 1);
        }
      }
    }
    return matrix;
  }

  public bunkerPlaceableAt(bunker, roomMatrix, x, y): boolean {
    console.log("Bunker Placabe At:");
    console.log(roomMatrix);
    if ((x < 1) || (x + this.size.x > 48) || (y < 1) || (y + this.size.y > 48)) {
      return false;
    } else {
      for (let i = 0; i < bunker.length; i++) {
        for (let j = 0; j < bunker[0].length; j++) {
          if ((roomMatrix.get(x + i, y + j) === 1) && bunker[i][j] === 1) {
            return false;
          }
        }
      }
      return true;
    }
  }
  public bunker2Matrix() {
    const matrix = new Array(this.size.y + 1);
    for (let i = 0; i < this.size.y + 1; i++) {
      matrix[i] = new Array(this.size.x + 1).fill(0);
    }

    for (const i in this.rcl8.buildings) {
      for (const j in this.rcl8.buildings[i].pos) {
        matrix[this.rcl8.buildings[i].pos[j].y][this.rcl8.buildings[i].pos[j].x] = 1;
      }
    }
    return matrix;
  }

  public room2Matrix() {
    const matrix = new PathFinder.CostMatrix();
    for (let i = 0; i <= 49; i++) {
      for (let j = 0; j <= 49; j++) {
        if (this.room.lookForAt(LOOK_TERRAIN, i, j)[0] === "wall" ) {
          matrix.set(i, j, 0);
        } else {
          matrix.set(i, j, 1);
        }
      }
    }
    return matrix;
  }

  public setSizeBunker() {
    let m_x = 200;
    let m_y = 200;
    let max_x = 0;
    let max_y = 0;
    for (const i in this.rcl8.buildings) {
      for (const j in this.rcl8.buildings[i].pos) {
        if (m_x > this.rcl8.buildings[i].pos[j].x) {
          m_x = this.rcl8.buildings[i].pos[j].x;
        }
        if (max_x < this.rcl8.buildings[i].pos[j].x) {
          max_x = this.rcl8.buildings[i].pos[j].x;
        }
        if (m_y > this.rcl8.buildings[i].pos[j].y) {
          m_y = this.rcl8.buildings[i].pos[j].y;
        }
        if (max_y < this.rcl8.buildings[i].pos[j].y) {
          max_y = this.rcl8.buildings[i].pos[j].y;
        }
      }
    }

    const size_x = max_x - m_x;
    const size_y = max_y - m_y;
    const size = {x: size_x, y: size_y};
    this.size = size;
  }
}
