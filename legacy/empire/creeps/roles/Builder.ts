import { BuildContainer } from "../jobs/BuildContainer";
import { BuildExtension } from "../jobs/BuildExtension";
import { BuildExtractor } from "../jobs/BuildExtractor";
import { BuildLab } from "../jobs/BuildLab";
import { BuildLink } from "../jobs/BuildLink";
import { BuildNuker } from "../jobs/BuildNuker";
import { BuildObserver } from "../jobs/BuildObserver";
import { BuildPowerSpawn } from "../jobs/BuildPowerSpawn";
import { BuildRampart } from "../jobs/BuildRampart";
import { BuildRoad } from "../jobs/BuildRoad";
import { BuildSpawn } from "../jobs/BuildSpawn";
import { BuildStorage } from "../jobs/BuildStorage";
import { BuildTerminal } from "../jobs/BuildTerminal";
import { BuildTower } from "../jobs/BuildTower";
import { BuildWall } from "../jobs/BuildWall";
import { KillSelf } from "../jobs/KillSelf";
import { PickupNearest } from "../jobs/PickupNearest";
import { CreepRole } from "./CreepRole";

export class Builder extends CreepRole {
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
        "BuildExtension": BuildExtension,
        "BuildSpawn": BuildSpawn,
        "BuildTower": BuildTower,
        "BuildStorage": BuildStorage,
        "BuildContainer": BuildContainer,
        "BuildExtractor": BuildExtractor,
        "BuildNuker": BuildNuker,
        "BuildObserver": BuildObserver,
        "BuildRampart": BuildRampart,
        "BuildLink": BuildLink,
        "BuildRoad": BuildRoad,
        "BuildWall": BuildWall,
        "BuildLab": BuildLab,
        "BuildTerminal": BuildTerminal,
        "BuildPowerSpawn": BuildPowerSpawn,
        "PickupNearest": PickupNearest,
    "KillSelf": KillSelf};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		  super.run();
    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		const energyCap = Math.min(Math.max(300,spawn.room.energyAvailable),2400);
		let partArray: BodyPartConstant[] = [];
		const fullSets = Math.max(1, Math.floor(energyCap/200));
		if(energyCap - fullSets*200 > 100){
			partArray = [MOVE,CARRY]
		}
		for (let i = 0; i < fullSets; i++){
			partArray = partArray.concat([WORK,CARRY,MOVE]);
		}
		return partArray;
		
	}
}