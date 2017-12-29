import {JobManager} from "./jobManager";

/**
 * The Jobclass meant to be exported
 */

export class Job {
  public name: string; // Name of the Job, is its unique key
  public type: string; // String describing the JobClass
  public priority: number; // Priority of theJob
  public data: any; // Data of the Job, declared in the interace pre Job Definition, should be seralizeable
  public wait: boolean; // Is the job postopned ? Waiting for a Number of ticks or for  another Job
  public manager: JobManager; // link to the JobManager
  public completed: boolean; // Did the Job run this tick ?
  public parent: string | undefined; // was it forked by another Job ?
  public ticked: boolean;

  constructor(data: SerializedJob, manager: JobManager) {
    this.name = data.name;
    this.type = data.type;
    this.completed = false;
    this.wait = data.wait;
    this.priority = data.priority;
    this.data = data.data;
    this.parent = data.parent;
    this.manager = manager;
    this.ticked = false;
  }

  /**
   * Returns a seralized job meant to be saved to memory
   * @returns {SerializedJob}
   */
  public complete() {
    console.log("Completed Job: "+this.name);
    this.completed = true;
    if (!!this.parent) {
      console.log("And set reset Parent wait");
      this.manager.getJob(this.parent).wait = false;
    }
  }

  public serialize() {
    let parent;
    if (this.parent) {
      parent = this.parent;
    }
    return {
      name: this.name,
      type: this.type,
      priority: this.priority,
      data: this.data,
      wait: this.wait,
      parent} as SerializedJob;
  }

  /**
   * Forks the job in the jobmanager generating a new Job with the designated data
   * @param {string} name
   * @param jobType
   * @param {number} priority
   * @param data
   */
  public fork(name: string, jobType: any, priority: number, data: any) {
    this.manager.addJob(name, jobType , priority, data, this.name);
  }

  /**
   * The Run Method, overwritten by extending classes
   */
  public run() {
    console.log("Job " + this.name + " is missing a type.");
    this.completed = true;
  }
}
