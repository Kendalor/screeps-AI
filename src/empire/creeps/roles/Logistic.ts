import { LogisticJob } from "../jobs/LogisticJob";
import { CreepRole } from "./CreepRole";



export class Logistic extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
        "LogisticJob": LogisticJob};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		super.run();
    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		return [CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE];
		
	}


}