import { DeliverToHomeRoom } from "../jobs/DeliverToHomeRoom";
import { DoNotBlockStuff } from "../jobs/DoNotBlockStuff";
import { GoToTargetRoom } from "../jobs/GoToTargetRoom";
import { PickupContainer } from "../jobs/PickupContainer";
import { PickupDropped } from "../jobs/PickupDropped";
import { PickupTombstone } from "../jobs/PickupTombstone";
import { CreepRole } from "./CreepRole";



export class HaulDeposit extends CreepRole {

    
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {
		"GoToTargetRoom": GoToTargetRoom,
		"DeliverToHomeRoom": DeliverToHomeRoom,
		"PickupDropped": PickupDropped,
		"PickupTombstone": PickupTombstone,
		"PickupContainer": PickupContainer,
		"DoNotBlockStuff": DoNotBlockStuff};
	
    constructor(creep: Creep) {
        super(creep);
    }

    public run(): void {
		super.run();
    }
	

}