
import { BuildMiningContainer } from "../jobs/BuildMiningContainer";
import { Mine } from "../jobs/Mine";
// import { SupplyMiningContainer } from "../jobs/SupplyMiningContainer";
import { CreepRole } from "./CreepRole";


export class Miner extends CreepRole{

    

	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {"MineContainer": Mine};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
        super.run();

    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		return [WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE] as BodyPartConstant[] ;
		
	}


}