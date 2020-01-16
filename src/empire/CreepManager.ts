import { EmpireManager } from "empire/EmpireManager";
import { ErrorMapper } from "utils/ErrorMapper";
import { Attacker } from "./creeps/roles/Attacker";
import { Builder } from "./creeps/roles/Builder";
import { Claimer } from "./creeps/roles/Claimer";
import { Colonize } from "./creeps/roles/Colonize";
import { Hauler } from "./creeps/roles/Hauler";
import { Logistic } from "./creeps/roles/Logistic";
import { Maintenance } from "./creeps/roles/Maintenance";
import { Miner } from "./creeps/roles/Miner";
import { RemoveInvader } from "./creeps/roles/RemoveInvader";
import { Repairer } from "./creeps/roles/Repairer";
import { Scout } from "./creeps/roles/Scout";
import { Supply } from "./creeps/roles/Supply";
import { Upgrader } from "./creeps/roles/Upgrader";

export const ROLE_STORE: any = {Logistic, Maintenance, Miner, Hauler, Upgrader, Supply, Repairer, Builder, Claimer, Colonize, Attacker, Scout,RemoveInvader};

export class CreepManager {

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
                }
            } catch (e) {
                if(e instanceof Error){
                    console.log("ERROR for Creep: " +c + "with Role: " + Game.creeps[c].memory.role + " ERROR MSG: " + `<span style='color:red'>${_.escape(ErrorMapper.sourceMappedStackTrace(e))}</span>`);
                }
                
            }

        }
    }
}