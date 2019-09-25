import { Maintenance } from "./roles/Maintenance";

export const ROLE_STORE: any = {Maintenance};

export class CreepManager {
    public run(): void {
        for(const c in Game.creeps){
            // console.log("Iterating over Creeps current at: "+ JSON.stringify(Game.creeps[c]));
            if( Game.creeps[c].memory.role !== undefined) {
                const role = new ROLE_STORE[Game.creeps[c].memory.role](Game.creeps[c]);
                role.run();
            } else {
                console.log("Creep: " + c + "Has no Role !");
            }
        }
    }
}