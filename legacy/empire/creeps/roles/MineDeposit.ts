import { GoToTargetRoom } from "../jobs/GoToTargetRoom";
import { MineDepo } from "../jobs/MineDepo";
import { CreepRole } from "./CreepRole";



export class MineDeposit extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
		"GoToTargetRoom": GoToTargetRoom,
		"MineDeposit": MineDepo
	};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		super.run();
    }
	


}