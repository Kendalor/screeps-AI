import { Build } from "../jobs/Build";
import { Harvest } from "../jobs/Harvest";
import { PickupContainer } from "../jobs/PickupContainer";
import {PickupDropped} from "../jobs/PickupDropped";
import { PickupStorage } from "../jobs/PickupStorage";
import {PickupTombstone} from "../jobs/PickupTombstone";
import { Repair } from "../jobs/Repair";
import { SupplyExtension } from "../jobs/SupplyExtension";
import { SupplySpawn } from "../jobs/SupplySpawn";
import { SupplyTower } from "../jobs/SupplyTower";
import { Upgrade } from "../jobs/Upgrade";
import { CreepRole } from "./CreepRole";


export class Allrounder extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
		"SupplyTower": SupplyTower,
		"SupplyExtension": SupplyExtension,
		"SupplySpawn": SupplySpawn,
		"Repair": Repair,
		"Build": Build,
		"Upgrade": Upgrade,
		"PickupDropped": PickupDropped,
		"PickupTomstone": PickupTombstone,
		"PickupStorage": PickupStorage,
		"PickupContainer": PickupContainer,
		"Harvest": Harvest};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		if(this.creep.memory.job === undefined || this.jobs[this.creep.memory.job] === undefined) {
			if(this.creep.room.controller!.ticksToDowngrade < 5000){
				this.creep.memory.targetId = this.jobs.Upgrade.getTargetId(this.creep);
				this.setJob("Upgrade");
				this.run();
			} else {
				super.run();
			}
		} else if( this.creep.memory.job !== undefined ) {
			this.jobs[this.creep.memory.job].run(this.creep);
		}
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