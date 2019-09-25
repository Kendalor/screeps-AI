import { Build } from "../jobs/Build";
import { Harvest } from "../jobs/Harvest";
import { Haul } from "../jobs/Haul";
import {PickupDropped} from "../jobs/PickupDropped";
import {PickupTombstone} from "../jobs/PickupTombstone";
import { Repair } from "../jobs/Repair";
import { Upgrade } from "../jobs/Upgrade";


export class Maintenance {

    
	public creep: Creep;
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {"Haul": Haul,
	"Build": Build, "Repair": Repair, "Upgrade": Upgrade, "PickupDropped": PickupDropped, "PickupTomstone": PickupTombstone,  "Harvest": Harvest};
	
    constructor(creep: Creep) {
        this.creep = creep;
    }

    public run(): void {
		if(this.creep.memory.job === undefined || this.jobs[this.creep.memory.job] === undefined) {
			if(this.creep.room.controller!.ticksToDowngrade < 5000){
				this.creep.memory.targetId = this.jobs.Upgrade.getTargetId(this.creep);
				this.setJob("Upgrade");
				this.run();
			} else {
				for(const job of Object.keys(this.jobs)) {
					if( this.creep.memory.job === undefined && this.jobs[job].runCondition(this.creep) && this.jobs[job].getTargetId(this.creep) !== null) {
						this.creep.memory.targetId = this.jobs[job].getTargetId(this.creep);
						this.setJob(job);
						this.run();
					}
				}
			}
		} else if( this.creep.memory.job !== undefined ) {
			this.jobs[this.creep.memory.job].run(this.creep);
		}
    }
    public setJob(j: string): void {
		this.creep.memory.job = j;
	}
	
	public static getBody(energy: number): BodyPartConstant[] {
		const energyCap = Math.min(energy,1200);
		let partArray: BodyPartConstant[] = [];
		const fullSets = Math.min(Math.max(1, Math.floor(energyCap/200)), 4);
		if(energyCap - fullSets*200 > 100){
			partArray = [MOVE,CARRY]
		}
		for (let i = 0; i < fullSets; i++){
			partArray = partArray.concat([WORK,CARRY,MOVE]);
		}
		return partArray;
		
	}


}