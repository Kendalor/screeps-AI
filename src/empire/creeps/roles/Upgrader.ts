import { PickupStorage } from "../jobs/PickupStorage";
import { Upgrade } from "../jobs/Upgrade";
import { CreepRole } from "./CreepRole";


export class Upgrader extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
		"Upgrade": Upgrade,
		"PickupStorage": PickupStorage};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
        super.run();

    }

	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		const energyCap = spawn.room.energyCapacityAvailable - 300;
		let partArray: BodyPartConstant[] = [WORK,CARRY,CARRY,MOVE,MOVE];
		const fullSets = Math.min(7,Math.max(1, Math.floor(energyCap/250)));
		for (let i = 0; i < fullSets; i++){
			partArray = partArray.concat([WORK,WORK,MOVE]);
		}
		return partArray;
		
	}


}