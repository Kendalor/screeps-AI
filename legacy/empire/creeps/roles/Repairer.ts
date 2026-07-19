import { DoNotBlockStuff } from "../jobs/DoNotBlockStuff";
import { KillSelf } from "../jobs/KillSelf";
import { PickupContainer } from "../jobs/PickupContainer";
import { PickupDropped } from "../jobs/PickupDropped";
import { PickupStorage } from "../jobs/PickupStorage";
import { RepairContainer } from "../jobs/RepairContainer";
import { RepairExtension } from "../jobs/RepairExtension";
import { RepairExtractor } from "../jobs/RepairExtractor";
import { RepairLab } from "../jobs/RepairLab";
import { RepairLink } from "../jobs/RepairLink";
import { RepairNuker } from "../jobs/RepairNuker";
import { RepairObserver } from "../jobs/RepairObserver";
import { RepairRampart } from "../jobs/RepairRampart";
import { RepairRoad } from "../jobs/RepairRoad";
import { RepairSpawn } from "../jobs/RepairSpawn";
import { RepairStorage } from "../jobs/RepairStorage";
import { RepairTower } from "../jobs/RepairTower";
import { RepairWall } from "../jobs/RepairWall";
import { CreepRole } from "./CreepRole";

export class Repairer extends CreepRole {
    // ORDER OF ENTRIES  === PRIORITY
    // tslint:disable:object-literal-sort-keys
	public jobs: {[name: string]: any} = {
        "RepairExtension": RepairExtension,
        "RepairSpawn": RepairSpawn,
        "RepairTower": RepairTower,
        "RepairStorage": RepairStorage,
        "RepairContainer": RepairContainer,
        "RepairExtractor": RepairExtractor,
        "RepairNuker": RepairNuker,
        "RepairObserver": RepairObserver,
        "RepairRampart": RepairRampart,
        "RepairRoad": RepairRoad,
        "RepairWall": RepairWall,
        "RepairLab": RepairLab,
        "RepairLink": RepairLink,
        "PickupDropped": PickupDropped,
        "PickupStorage": PickupStorage,
        "PickupContainer": PickupContainer,
        "KillSelf": KillSelf,
        "DoNotBlockStuff": DoNotBlockStuff};
	// tslint:enable:object-literal-sort-keys
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		super.run();
    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		const energyCap = Math.min(Math.max(300,spawn.room.energyAvailable),1200);
		let partArray: BodyPartConstant[] = [];
		const fullSets = Math.min(Math.max(1, Math.floor(energyCap/200)), 4);
		if(energyCap - fullSets*200 > 100){
			partArray = [MOVE,CARRY]
		}
		for (let i = 0; i < fullSets; i++){
			partArray = partArray.concat([WORK,CARRY,MOVE]);
		}
		return partArray;
		
	}
}