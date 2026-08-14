import { Attack } from "../jobs/Attack";
import { GoToTargetRoom } from "../jobs/GoToTargetRoom";
import { CreepRole } from "./CreepRole";

export class Attacker extends CreepRole {

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
		return [];
		
	}
}