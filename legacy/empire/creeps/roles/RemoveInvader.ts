import { Attack } from "../jobs/Attack";
import { GoToTargetRoom } from "../jobs/GoToTargetRoom";
import { CreepRole } from "./CreepRole";

export class RemoveInvader extends CreepRole {


	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
		"GoToTargetRoom": GoToTargetRoom,
		  "Attack": Attack};
	  
	  constructor(creep: Creep) {
		  super(creep);
	  }
  
	  public run(): void {
		  super.run();
	  }
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		const energyCap = Math.min(Math.max(300,spawn.room.energyAvailable),2600);
		let partArray: BodyPartConstant[] = [];
		const fullSets = Math.max(1, Math.floor(energyCap/130));
		for (let i = 0; i < fullSets; i++){
			partArray = partArray.concat([MOVE,ATTACK]);
		}
		return partArray;
		
	}
}