import { Build } from "../jobs/Build";
import { BuildSpawn } from "../jobs/BuildSpawn";
import { EmergencyUpgrade } from "../jobs/EmergencyUpgrade";
import { GoFlagRoom } from "../jobs/GoFlagRoom";
import { Harvest } from "../jobs/Harvest";
import { PickupContainer } from "../jobs/PickupContainer";
import {PickupDropped} from "../jobs/PickupDropped";
import { PickupStorage } from "../jobs/PickupStorage";
import {PickupTombstone} from "../jobs/PickupTombstone";
import { Renew } from "../jobs/Renew";
import { Repair } from "../jobs/Repair";
import { SupplyExtension } from "../jobs/SupplyExtension";
import { SupplySpawn } from "../jobs/SupplySpawn";
import { SupplyTower } from "../jobs/SupplyTower";
import { Upgrade } from "../jobs/Upgrade";
import { CreepRole } from "./CreepRole";


export class Colonize extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
        "GoFlagRoom": GoFlagRoom,
        "Renew": Renew,
        "BuildSpawn": BuildSpawn,
		"EmergencyUpgrade": EmergencyUpgrade,
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
		super.run();
    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		const energyCap = Math.min(Math.max(300,spawn.room.energyCapacityAvailable),2400);
		let partArray: BodyPartConstant[] = [];
		const fullSets = Math.min(Math.max(1, Math.floor(energyCap/200)), 8);
		if(energyCap - fullSets*200 > 100){
			partArray = [MOVE,CARRY]
		}
		for (let i = 0; i < fullSets; i++){
			partArray = partArray.concat([WORK,CARRY,MOVE]);
		}
		return partArray;
		
	}


}