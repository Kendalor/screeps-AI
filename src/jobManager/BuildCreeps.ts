import {Job} from "./Job";

export class BuildCreeps extends Job {

  public run() {
    const harvesters = _.filter(Game.creeps, (creep) => creep.memory.role === "harvester");
    console.log("Harvesters: " + harvesters.length);

    if (harvesters.length < 5) {
      const newName = "Harvester" + Game.time;
      console.log("Spawning new harvester: " + newName);
      Game.spawns.Spawn1.spawnCreep([WORK, CARRY, MOVE], newName,
        {memory: {role: "harvester"}});
    }

    if (Game.spawns.Spawn1.spawning) {
      const spawningCreep = Game.creeps[Game.spawns.Spawn1.spawning.name];
      Game.spawns.Spawn1.room.visual.text(
        "🛠️" + spawningCreep.memory.role,
        Game.spawns.Spawn1.pos.x + 1,
        Game.spawns.Spawn1.pos.y,
        {align: "left", opacity: 0.8});
    }
    this.completed = true;
  }
}
