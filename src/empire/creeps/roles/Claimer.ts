import { Claim } from "../jobs/Claim";
import { GoFlagRoom } from "../jobs/GoFlagRoom";
import { CreepRole } from "./CreepRole";


export class Claimer extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
        "GoFlagRoom": GoFlagRoom,
        "Claim": Claim};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		super.run();
    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
        return [CLAIM,MOVE];
		
	}


}