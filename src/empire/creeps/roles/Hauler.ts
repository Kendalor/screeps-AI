import { DoNotBlockStuff } from "../jobs/DoNotBlockStuff";
import { PickupContainer } from "../jobs/PickupContainer";
import { PickupDropped } from "../jobs/PickupDropped";
import { PickupTombstone } from "../jobs/PickupTombstone";
import { SupplyStorage } from "../jobs/SupplyStorage";
import { CreepRole } from "./CreepRole";



export class Hauler extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
        "SupplyStorage": SupplyStorage,
		"PickupDropped": PickupDropped,
		"PickupTombstone": PickupTombstone,
		"PickupContainer": PickupContainer,
		"DoNotBlockStuff": DoNotBlockStuff};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		super.run();
    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		const energyCap = Math.min(Math.max(300,spawn.room.energyCapacityAvailable),1200);
		let partArray: BodyPartConstant[] = [];
		const fullSets = Math.max(1, Math.floor(energyCap/150));
		for (let i = 0; i < fullSets; i++){
			partArray = partArray.concat([CARRY,CARRY,MOVE]);
		}
		return partArray;
		
	}


}