
import { BuildMiningContainer } from "../jobs/BuildMiningContainer";
import { GetMiningContainerId } from "../jobs/GetMiningContainerId";
import { MineContainer } from "../jobs/MineContainer";
import { PlaceMiningContainer } from "../jobs/PlaceMiningContainer";
import { CreepRole } from "./CreepRole";


export class ContainerMiner extends CreepRole{

    

	// ORDER OF ENTRIES  === PRIORITY
    public jobs: {[name: string]: any} = {"MineContainer": MineContainer,              
                "GetMiningContainerid": GetMiningContainerId,
                "BuildMiningContainer": BuildMiningContainer,
                "PlaceMiningContainer": PlaceMiningContainer};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
        super.run();

    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		return [WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE] as BodyPartConstant[] ;
		
	}


}