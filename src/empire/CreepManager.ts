import { EmpireManager } from "empire/EmpireManager";
import { Attacker } from "./creeps/roles/Attacker";
import { Builder } from "./creeps/roles/Builder";
import { Claimer } from "./creeps/roles/Claimer";
import { Colonize } from "./creeps/roles/Colonize";
import { ContainerMiner } from "./creeps/roles/ContainerMiner";
import { Hauler } from "./creeps/roles/Hauler";
import { Maintenance } from "./creeps/roles/Maintenance";
import { Repairer } from "./creeps/roles/Repairer";
import { Supply } from "./creeps/roles/Supply";
import { Upgrader } from "./creeps/roles/Upgrader";

export const ROLE_STORE: any = {Maintenance, ContainerMiner, Hauler, Upgrader, Supply, Repairer, Builder, Claimer, Colonize, Attacker};

export class CreepManager {

    public empire: EmpireManager;
    
    constructor(emp: EmpireManager){
        this.empire=emp;
    }

    public run(): void {
        for(const c in Game.creeps){
            try {
                if( Game.creeps[c].memory.role !== undefined) {
                    const time = Game.cpu.getUsed();
                    const role = new ROLE_STORE[Game.creeps[c].memory.role](Game.creeps[c]);
                    role.run();
                    this.empire.stats.addCreep( Game.cpu.getUsed() - time, Game.creeps[c].memory.role );
                } else {
                    console.log("Creep: " + c + "Has no Role !");
                }
            } catch (error) {
                console.log("ERROR for Creep: " +c + "with Role: " + Game.creeps[c].memory.role + " ERROR MSG: " + error);
            }

        }
    }
}