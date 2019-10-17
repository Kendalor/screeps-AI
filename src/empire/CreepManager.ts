import { EmpireManager } from "empire/EmpireManager";
import { Builder } from "./creeps/roles/Builder";
import { Hauler } from "./creeps/roles/Hauler";
import { Maintenance } from "./creeps/roles/Maintenance";
import { Miner } from "./creeps/roles/Miner";
import { Repairer } from "./creeps/roles/Repairer";
import { Supply } from "./creeps/roles/Supply";
import { Upgrader } from "./creeps/roles/Upgrader";

export const ROLE_STORE: any = {Maintenance, Miner, Hauler, Upgrader, Supply, Repairer, Builder};

export class CreepManager {

    public empire: EmpireManager;
    
    constructor(emp: EmpireManager){
        this.empire=emp;
    }

    public run(): void {
        for(const c in Game.creeps){
            try {
                if( Game.creeps[c].memory.role !== undefined) {
                    const role = new ROLE_STORE[Game.creeps[c].memory.role](Game.creeps[c]);
                    role.run();
                } else {
                    console.log("Creep: " + c + "Has no Role !");
                }
            } catch (error) {
                console.log(error);
            }

        }
    }
}