import { ScoutingJob } from "../jobs/ScoutingJob";
import { CreepRole } from "./CreepRole";



export class Scout extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
        "ScoutingJob": ScoutingJob};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		super.run();
    }

}