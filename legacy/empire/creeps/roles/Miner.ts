import { MineContainer } from "../jobs/MineContainer";
import { MineLink } from "../jobs/MineLink";
import { MineLinkMulti } from "../jobs/MineLinkMulti";
import { MineOverflow } from "../jobs/MineOverflow";
import { CreepRole } from "./CreepRole";


export class Miner extends CreepRole{

    

	// ORDER OF ENTRIES  === PRIORITY
    public jobs: {[name: string]: any} = {"MineLinkMulti": MineLinkMulti,
                "MineLink": MineLink,
                "MineContainer": MineContainer,              
                "MineOverflow": MineOverflow};
	
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