import { Build } from "../jobs/Build";
import { EmergencyUpgrade } from "../jobs/EmergencyUpgrade";
import { Harvest } from "../jobs/Harvest";
import { PickupContainer } from "../jobs/PickupContainer";
import {PickupDropped} from "../jobs/PickupDropped";
import { PickupStorage } from "../jobs/PickupStorage";
import {PickupTombstone} from "../jobs/PickupTombstone";
import { Repair } from "../jobs/Repair";
import { SupplyExtension } from "../jobs/SupplyExtension";
import { SupplySpawn } from "../jobs/SupplySpawn";
import { SupplyTerminal } from "../jobs/SupplyTerminal";
import { SupplyTower } from "../jobs/SupplyTower";
import { Upgrade } from "../jobs/Upgrade";
import { CreepRole } from "./CreepRole";


export class Maintenance extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
		"EmergencyUpgrade": EmergencyUpgrade,
		"SupplyTower": SupplyTower,
		"SupplyExtension": SupplyExtension,
		"SupplySpawn": SupplySpawn,
		"SupplyTerminal": SupplyTerminal,
		"Repair": Repair,
		"Build": Build,
		"Upgrade": Upgrade,
		"PickupDropped": PickupDropped,
		"PickupTomstone": PickupTombstone,
		"PickupStorage": PickupStorage,
		"PickupContainer": PickupContainer,
		"Harvest": Harvest
		};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		super.run();
    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		console.log("Maintenance GetBody");
		const energyCap = Math.min(Math.max(300,spawn.room.energyAvailable),2400);
		let partArray: BodyPartConstant[] = [];
		const fullSets = Math.min(Math.max(1, Math.floor(energyCap/250)), 4);
		console.log("Maintenance fullSets: " + fullSets);
		for (let i = 0; i < fullSets; i++){
			partArray = partArray.concat([WORK,CARRY,MOVE,MOVE]);
		}
		return partArray;
		
	}


}