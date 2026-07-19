import { GoToTargetRoom } from "../jobs/GoToTargetRoom";
import { Heal } from "../jobs/Heal";
import { CreepRole } from "./CreepRole";

export class Healer extends CreepRole {

	public jobs: {[name: string]: any} = {
		"GoToTargetRoom": GoToTargetRoom,
		  "Heal": Heal};
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