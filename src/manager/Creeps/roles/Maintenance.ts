import { Build } from "../jobs/Build";
import { Gather } from "../jobs/Gather";
import { Harvest } from "../jobs/Harvest";
import { Haul } from "../jobs/Haul";
import { Mine } from "../jobs/Mine";
import { Repair } from "../jobs/Repair";
import { Upgrade } from "../jobs/Upgrade";

export class Maintenance {
    // TODO
    
    public creep: Creep;
		public jobs: any = {Repair, Upgrade, Mine, Gather, Haul, Build, Harvest};
    constructor(creep: Creep) {
        this.creep = creep;
    }

    public run(): void {
        if (this.creep.memory.job === undefined) { 
					if(this.creep.room.controller!.ticksToDowngrade < 5000){
						if(this.jobs.Upgrade.runCondition(this.creep)){
							this.creep.memory.targetId = this.jobs.Upgrade.getTargetId(this.creep);
							this.setJob("Upgrade");
							this.run();
						}
					}
					if (this.jobs.Repair.runCondition()){
						this.creep.memory.targetId=this.jobs.Repair.getTargetId(this.creep);
						this.setJob("Repair");
						this.run();
					}
					if (this.jobs.Build.runCondition()){
						this.creep.memory.targetId=this.jobs.Build.getTargetId(this.creep);
						this.setJob("Build");
						this.run();
					}
					if (this.jobs.Haul.runCondition()){
						this.creep.memory.targetId=this.jobs.Haul.getTargetId(this.creep);
						this.setJob("Haul");
						this.run();
					}
					if (this.jobs.Upgrade.runCondition()){
						this.creep.memory.targetId=this.jobs.Upgrade.getTargetId(this.creep);
						this.setJob("Upgrade");
						this.run();
					}
					if (this.jobs.Salvage.runCondition()){
						this.creep.memory.targetId=this.jobs.Salvage.getTargetId(this.creep);
						this.setJob("Salvage");
						this.run();
					}
					
					if (this.jobs.Gather.runCondition()){
						this.creep.memory.targetId=this.jobs.Gather.getTargetId(this.creep);
						this.setJob("Gather");
						this.run();
					}
				}
			this.jobs[this.creep.memory.job](this.creep).run();
    }
    public setJob(j: string): void {
		this.creep.memory.job = j;
    }

}