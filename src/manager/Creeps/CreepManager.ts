import { Builder } from "./roles/Builder";
import { Hauler } from "./roles/Hauler";
import { Maintenance } from "./roles/Maintenance";
import { Miner } from "./roles/Miner";
import { Repairer } from "./roles/Repairer";
import { Supply } from "./roles/Supply";
import { Upgrader } from "./roles/Upgrader";

export const ROLE_STORE: any = {Maintenance, Miner, Hauler, Upgrader, Supply, Repairer, Builder};

export class CreepManager {
    public run(): void {
        for(const c in Game.creeps){
            if( Game.creeps[c].memory.role !== undefined) {
                const role = new ROLE_STORE[Game.creeps[c].memory.role](Game.creeps[c]);
                role.run();
            } else {
                console.log("Creep: " + c + "Has no Role !");
            }
        }
    }
}