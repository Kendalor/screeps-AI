export class CreepRole {
    
	public creep: Creep;
	// ORDER OF ENTRIES  === PRIORITY
	public jobs: {[name: string]: any} = {};
    
    constructor(creep: Creep){
        this.creep=creep;
    }

    public run(): void {
		if(this.creep.memory.job == null ) { 
            for(const job of Object.keys(this.jobs)) {
                if( this.creep.memory.job == null ){
                    if(this.jobs[job].runCondition(this.creep)) {
                        const target: string | null = this.jobs[job].getTargetId(this.creep);
                        
                        if(target != null) {
                            this.creep.memory.targetId = target;
                            this.setJob(job);
                            this.run();
                        }
                    }
                } 
            }
        } else if( this.jobs[this.creep.memory.job] == null){
            console.log("Running: " + this.creep.memory.role + " with Name " + this.creep.name + " : INVALID JOB FOUND: " + this.creep.memory.job);
            delete this.creep.memory.job;
            this.run();
        } else if(this.jobs[this.creep.memory.job] != null) {
            if( this.creep.memory.job != null ) {
                this.jobs[this.creep.memory.job].run(this.creep);
            }
        }

    }
    public setJob(j: string): void {
		this.creep.memory.job = j;
	}
	
	public static getBody(spawn: StructureSpawn): BodyPartConstant[] {
		return [] as BodyPartConstant[] ;
		
	}

}