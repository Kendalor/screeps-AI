import { EmpireManager } from "empire/EmpireManager";
import { Attacker } from "./creeps/roles/Attacker";
import { Builder } from "./creeps/roles/Builder";
import { Claimer } from "./creeps/roles/Claimer";
import { Colonize } from "./creeps/roles/Colonize";
import { HaulDeposit} from "./creeps/roles/HaulDeposit";
import { Hauler } from "./creeps/roles/Hauler";
import { Logistic } from "./creeps/roles/Logistic";
import { Maintenance } from "./creeps/roles/Maintenance";
import { MineDeposit } from "./creeps/roles/MineDeposit";
import { Miner } from "./creeps/roles/Miner";
import { MineralMiner } from "./creeps/roles/MineralMiner";
import { RemoveInvader } from "./creeps/roles/RemoveInvader";
import { Repairer } from "./creeps/roles/Repairer";
import { Scout } from "./creeps/roles/Scout";
import { Supply } from "./creeps/roles/Supply";
import { Upgrader } from "./creeps/roles/Upgrader";
import { Healer } from "./creeps/roles/Healer";
import { defaults, isArray, round } from "lodash";

export const ROLE_STORE: any = {Logistic, Maintenance, Miner, Hauler, Upgrader, Supply, Repairer, Builder, Claimer, Colonize, Attacker, Scout,RemoveInvader, MineralMiner, HaulDeposit, MineDeposit, Healer};

export class CreepManager implements ICreepManager {

    public empire: EmpireManager;
    
    constructor(emp: EmpireManager){
        this.empire=emp;
    }

    public run(): void {
        for(const c in Game.creeps){
            try {
                if( Game.creeps[c].memory.role != null) {
                    if(ROLE_STORE[Game.creeps[c].memory.role] != null) {
                        const time = Game.cpu.getUsed();
                        const role = new ROLE_STORE[Game.creeps[c].memory.role](Game.creeps[c]);
                        role.run();
                        this.empire.stats.addCreep( Game.cpu.getUsed() - time, Game.creeps[c].memory.role );
                    } else {
                        console.log("Found invalid Role: "+ Game.creeps[c].memory.role + " on Creep: " + c + " Creep will be deleted");
                        Game.creeps[c].suicide();
                    }

                } else {
                    console.log("Creep: " + c + "Has no Role !");
                    this.checkInterShardMemory(Game.creeps[c]);
                }
            } catch (e) {
                if(e instanceof Error){
                    console.log("ERROR for Creep: " +c + "with Role: " + Game.creeps[c].memory.role + " ERROR MSG: " + e);
                }
                
            }

        }
    }

    public checkInterShardMemory(creep: Creep): void {
        const shards = ["shard0", "shard1", "shard2", "shard3"];
        for(const s of shards){
            if(s !== Game.shard.name){
                const mem = JSON.parse(InterShardMemory.getRemote(s) || "{}");
                console.log("Fetched InterShardMem for Shard " + s + " : " + JSON.stringify(mem));
                if(mem.creeps != null){
                    if(mem.creeps[creep.name] != null){
                        Memory.creeps[creep.name] = mem.creeps[creep.name];
                        console.log("Memory for Creep: " + creep.name +" found in intershardMem");
                    }
                }
            }

        }

    }
}