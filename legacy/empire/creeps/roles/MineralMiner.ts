import { DoNotBlockStuff } from "../jobs/DoNotBlockStuff";
import { MineMineral } from "../jobs/MineMineral";
import { CreepRole } from "./CreepRole";


export class MineralMiner extends CreepRole{

    

	// ORDER OF ENTRIES  === PRIORITY
    public jobs: {[name: string]: any} = {
        "MineMineral": MineMineral,
        "DoNotBlockStuff": DoNotBlockStuff};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
        super.run();

    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
        let out = new Array<BodyPartConstant>();
        const base = [WORK,MOVE];
        const baseCost = 200;
        const numSets = Math.min(25,Math.floor(spawn.room.energyCapacityAvailable /150));
        for(let i=0; i<numSets; i++){
            out=out.concat(base)
        }
        console.log(JSON.stringify(out));
		return out;
		
	}


}