import { Build } from "../jobs/Build";
import { Gather } from "../jobs/Gather";
import { Harvest } from "../jobs/Harvest";
import { Haul } from "../jobs/Haul";
import { Job } from "../jobs/Job";
import { Mine } from "../jobs/Mine";
import { Repair } from "../jobs/Repair";
import { Upgrade } from "../jobs/Upgrade";

export class Maintenance {
    // TODO
    
    public creep: Creep;
    public jobs: any = {Repair, Upgrade, Mine, Gather, Haul, Build, Harvest};
    public job: Job | undefined ;
    constructor(creep: Creep) {
        this.creep = creep;
    }

    public run(): void {
        if (this.creep.memory.job === undefined) {
            if(this.creep.room.controller!.ticksToDowngrade < 5000){
                this.setJob("Upgrade");
            }
            
			// if(creep.room.memory.underAttack)
			//    this.repair(creep);
			
			this.setJob("Repair");
			this.setJob("Build");
			
			this.setJob("Haul");
			this.setupgrade(creep);
			this.salvage(creep);
			this.gather(creep);
		}else{
			switch(creep.memory.job) {
				case 'build':
					this.build(creep);
					break;
				case 'gather':
					this.gather(creep);
					break;
				case 'haul':
					this.haul(creep);
					break;
				case 'repair':
					this.repair(creep);
					break;
				case 'salvage':
					this.salvage(creep);
					break;
				case 'upgrade':
					this.upgrade(creep);
					break;
				default:
					this.harvestCancel(creep);
			}
		}
    }
    public setJob(j: string): void {
        this.job = new this.jobs[j](this.creep) as Job;
    }

}