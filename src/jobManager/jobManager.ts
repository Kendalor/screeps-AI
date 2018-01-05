
import {IBUCreep} from "./IBUCreepJob";
import {InitialBuildUpJob} from "./InitialBuildUpJob";
import {InitJob} from "./initJob";
import {Job} from "./Job";
import {RoomManager} from "./RoomManager";
import {BuildCreep} from "./BuildCreep";
import {CreepHarvest} from "./CreepHarvest";
import {CreepUpgrade} from "./CreepUpgrade";
import {CreepBuild} from "./CreepBuild";
import {CreepSupply} from "./CreepSupply";
import {RoomData} from "./RoomData";

/**
 * LOokup Table for all classes used for jobs so Jobs can be initalized depending on the string in the seralizedJob variable in Memory
 * @type {{[p: string]: any}}
 */
export const jobTypes = {
  "RoomManager": RoomManager,
  "InitJob": InitJob,
  "IBU": InitialBuildUpJob,
  "IBUCreep": IBUCreep,
  "BuildCreep": BuildCreep,
  "CreepHarvest": CreepHarvest,
  "CreepBuild": CreepBuild,
  "CreepSupply": CreepSupply,
  "CreepUpgrade": CreepUpgrade,
} as {[type: string]: any};

interface JobList {
  [name: string]: Job;
}

/**
 * The Jobmanager class
 * Keeps a list of Jobs to execute, ordered by priority
 */
export class JobManager {
  public jobList: JobList= {};
  public spawns;
  public limit = Game.cpu.limit;
  public roomData: {[key: string]: RoomData};
  constructor() {
    if (!Memory.JobManager) {
      Memory.JobManager = {};
    }
    this.readJobsFromMemory();
    this.addJob("InitJob", InitJob, 99 , {});
    }

  /**
   * Testing Puropses
   */
 public sayHello() {
   console.log("Test");
 }

  /**
   * Executes a Job with the highest priority
   */
 public runJob() {
    const job = this.getJobWithPriority();
    try {
      const tick = Game.cpu.getUsed();
      job.run();
      const used = Game.cpu.getUsed() - tick;
      if (global.verbose) {
        console.log("Did Run Job: " + job.name + " Priority: " + job.priority + " at GameTime: " + Game.time + " used " + used + " CPU");
      }
    } catch (e) {
      //job.complete();
      console.log("job " + job.name + " failed with error " + e);
    }
    job.ticked = true;
 }

 public getJob(name: string): Job{
   return this.jobList[name];
 }
  /**
   * Searches the Joblist for the job with the highest priority which isn't completed and not on wait mode
   * @returns {Job}
   */
  public getJobWithPriority(): Job {
    const jobs = _.filter(this.jobList, function(entry) {
      return (!entry.ticked && entry.wait === false);
    });
    return _.sortBy(jobs, "priority").reverse()[0];
 }

  /**
   * Looks if there is an executable Job in the List
   * @returns {boolean}
   */
 public canRun() {
   return (!!this.getJobWithPriority());
 }

  /**
   * Writes all not executed Jobs into Memory for next tick
   */
  public writeJobsToMemory() {
  const list: SerializedJob[] = [];
  _.forEach(this.jobList, function(entry) {
    if (!entry.completed) {
      list.push(entry.serialize());
    }
  });
  Memory.JobManager.jobList = list;
}

  /**
   * Reads jobs from Memory and adds them into the Joblist
   */
  public readJobsFromMemory() {
    const manager = this;
    _.forEach(Memory.JobManager.jobList, function(entry) {
      if ( jobTypes[entry.type]) {
        manager.jobList[entry.name] = new jobTypes[entry.type](entry, manager);
      } else {
        manager.jobList[entry.name] = new Job(entry, manager);
      }
  });
}

public addJob(name: string, jobClass: any, priority: number, data: {}, parent?: string | undefined ) {
  const job = new jobClass({ name: name, priority: priority, data, wait: false, parent}, this);
  this.jobList[name] = job;
  //console.log("added Job: " + job.name);
}

  /**
   * Removes a Job fromt he joblist depending on the Jobname
   * @param {string} name of the Job to be removed
   */
  public removeJob(name: string) {
    if (this.jobList[name]) {
      delete this.jobList[name];
    }
}

  /**
   * Checks if the Job is already in the list and if not the Job will be added to the List
   * @param {string} name
   * @param jobClass
   * @param {number} priority
   * @param {{}} data
   * @param {string | undefined} parent
   */
  public addJobIfNotExist(name: string, jobClass: any, priority: number, data: {}, parent?: string | undefined ) {
    //console.log( "Job" + name + " in Joblist: " + !this.hasJob(name) );
    if (!this.hasJob(name)) {
      //console.log("Nontheless Added Job");
      this.addJob(name, jobClass, priority, data, parent);
    }
  }

  /**
   * Returns a boolean depending if a Job with a given Name is already in the List
   * @param {string} name
   * @returns {boolean}
   */
  public hasJob(name: string) {
    return !!this.jobList[name];
}

  /**
   * Terminates the Jobmanager
   */
 public kill() {
    this.writeJobsToMemory();
  }

}
