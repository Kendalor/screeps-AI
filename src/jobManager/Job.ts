import {JobManager} from "./jobManager";

export class Job {
  public name: string;
  public type: string;
  public priority: number;
  public data: any;
  public wait: string | number | boolean;
  public manager: JobManager;
  public completed = false;
  public parent: Job | undefined;

  constructor(data: SerializedJob, manager: JobManager) {
    this.name = data.name;
    this.type = data.type;
    this.completed = false;
    this.wait = data.wait;
    this.priority = data.priority;
    this.data = data.data;
    this.manager = manager;
  }

  public serialize() {
    let parent;
    if (this.parent) {
      parent = this.parent.name;
    }
    return {
      name: this.name,
      type: this.type,
      priority: this.priority,
      data: this.data,
      wait: this.wait,
      parent} as SerializedJob;
  }

  public fork(name: string, jobType: any, priority: number, data: any) {
    this.manager.addJob(name, jobType , priority, data, this.name);
  }

  public run() {
    console.log("Job " + this.name + " is missing a type.");
    this.completed = true;
  }
}
