import { KillSelf } from "../jobs/KillSelf";
import { PickupStorage } from "../jobs/PickupStorage";
import { SupplyExtension } from "../jobs/SupplyExtension";
import { SupplySpawn } from "../jobs/SupplySpawn";
import { SupplyTower } from "../jobs/SupplyTower";
import { CreepRole } from "./CreepRole";

export class Supply extends CreepRole {
    	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
        "SupplyExtension": SupplyExtension,
        "SupplySpawn": SupplySpawn,
		"PickupStorage": PickupStorage,
		"SupplyTower": SupplyTower,
		"KillSelf": KillSelf};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		super.run();
    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		const energyCap = Math.min(Math.max(300,spawn.room.energyCapacityAvailable),1800);
		let partArray: BodyPartConstant[] = [];
		const fullSets = Math.max(1, Math.floor(energyCap/150));
		for (let i = 0; i < fullSets; i++){
			partArray = partArray.concat([CARRY,CARRY,MOVE]);
		}
		return partArray;
		
	}
}