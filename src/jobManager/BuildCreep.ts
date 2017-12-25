//TODO Add Check if spawns are sufficient to spawn the creep at all
import {Job} from "./Job";

interface BuildCreepData {
  body: string[];
  spawns: string[];
  name: string;
}

export class BuildCreep extends Job {
  public type = "BuildCreep";
  public data: BuildCreepData;
  public spawns: Spawn[];
  public run() {
    console.log("BuildCreepBugfix:");
    this.spawns = this.data.spawns.map(function(entry) {return Game.getObjectById(entry); });
    console.log(this.spawns);
    for (const i in this.spawns) {
      const spawn = this.spawns[i];
      if (!spawn.spawning && spawn.spawnCreep(this.data.body, this.data.name, {dryRun: true}) === OK ) {
        const result = spawn.spawnCreep(this.data.body, this.data.name);
        if (result === OK) {
          this.completed = true;
          break;
        }
      }
    }
  }
}
