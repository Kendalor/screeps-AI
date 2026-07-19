import { Claim } from "../jobs/Claim";
import { GoFlagRoom } from "../jobs/GoFlagRoom";
import { GoToTargetRoom } from "../jobs/GoToTargetRoom";
import { CreepRole } from "./CreepRole";


export class Claimer extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
      "GoFlagRoom": GoFlagRoom,
      "GoToTargetRoom": GoToTargetRoom,
        "Claim": Claim};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		super.run();
    }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
      const energyCap = Math.min(Math.max(300,spawn.room.energyAvailable),3250);
      let partArray: BodyPartConstant[] = [];
      const fullSets = Math.max(1, Math.floor(energyCap/650));
      for (let i = 0; i < fullSets; i++){
        partArray = partArray.concat([CLAIM,MOVE]);
      }
      return partArray;
		
	}


}