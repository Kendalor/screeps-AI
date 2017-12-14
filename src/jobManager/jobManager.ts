
import {BuildCreeps} from "./BuildCreeps";
//import {InitJob} from "./initJob";
import {Job} from "./Job";
import {RoomManager} from "./RoomManager";
import {RunCreeps} from "./RunCreeps";

const jobTypes = {
  "RunCreeps": RunCreeps,
  "BuildCreeps": BuildCreeps,
  "R_M": RoomManager
} as {[type: string]: any};

interface JobList {
  [name: string]: Job;
}

export class JobManager {
  public jobList: JobList= {};
  public spawns;
  public limit = Game.cpu.limit;
  constructor() {
    if (!Memory.JobManager) {
      Memory.JobMananager = {};
    }
    this.readJobsFromMemory();

    //this.addJob("InitJob", InitJob, 99 , {});
    this.addJob("RunCreeps", RunCreeps, 80 , {});
    this.addJob("BuildCreeps", BuildCreeps, 80 , {});
  }

 public sayHello() {
   console.log("Test");
 }

 public runJob() {
    const job = this.getJobWithPriority();
    try {
      job.run();
    } catch (e) {
      console.log("job " + job.name + " failed with error " + e);
    }
    job.completed = true;
 }
  public getJobWithPriority(): Job {
    const jobs = _.filter(this.jobList, function(entry) {
      return (!entry.completed && entry.wait === false);
    });
    return _.sortBy(jobs, "prority").reverse()[0];
 }

 public canRun() {
   return (!!this.getJobWithPriority());
 }

public writeJobsToMemory() {
  const list: SerializedJob[] = [];
  _.forEach(this.jobList, function(entry) {
    if (!entry.completed) {
      list.push(entry.serialize());
    }
  });
  Memory.jobManager.jobList = list;
}
public readJobsFromMemory() {
    const manager = this;
    _.forEach(Memory.JobManager, function(entry) {
      if ( jobTypes[entry.name]) {
        manager.jobList[entry.name] = new jobTypes[entry.type](entry, manager);
      } else {
        manager.jobList[entry.name] = new Job(entry, manager);
      }
  });
}

public addJob(name: string, jobClass: any, priority: number, data: {}, parent?: string | undefined ) {
  const job = new jobClass({name, prority: priority, data, wait: false, parent}, this);
  this.jobList[name] = job;
}

public removeJob(name: string) {
    if (this.jobList[name]) {
      delete this.jobList[name];
    }
}

public addJobIfNotExist(name: string, jobClass: any, priority: number, data: {}, parent?: string | undefined ) {
    if (!this.hasJob(name)) {
      this.addJob(name, jobClass, priority, data, parent);
    }
  }

public hasJob(name: string) {
    return !!this.jobList[name];
}

 public kill() {
    this.writeJobsToMemory();
  }

}
