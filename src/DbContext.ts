import firebase from "firebase/app";
import "firebase/auth";
import "firebase/firestore";
import "firebase/storage";
import DbSet from "./DbSet";
import AbstractEntity from "./entities/AbstractEntity";
import EmulatorConfig from "./entities/EmulatorConfig";
import DecoratorTool from "./tools/DecoratorTool";
import Condition from "./tools/Condition";
import StorageFile from "./entities/StorageFile";
import UploadTask = firebase.storage.UploadTask;

let canConfigEmulator = true;

export default class DbContext {

    private readonly db;
    public auth;
    private batch;
    private storageRef;
    private dbSetFieldNames: string[] = [];
    private fetchTimeOut = 3000;
    private check: any;
    private longRunningThread = false;
    private readonly addPagination: boolean;
    private entitySetCount = 0;

    public writeError = false;

    constructor(addPagination = false, emulatorConfig: EmulatorConfig | undefined = undefined) {
        this.addPagination = addPagination;

        if (emulatorConfig && canConfigEmulator) {
            if (emulatorConfig.firestorePort) {
                firebase.firestore().useEmulator(emulatorConfig.localhost, emulatorConfig.firestorePort);
            }

            if (emulatorConfig.authPort) {
                firebase.auth().useEmulator(`http://${emulatorConfig.localhost}:${emulatorConfig.authPort}`);
            }

            canConfigEmulator = false;
        }

        this.db = firebase.firestore();
        this.batch = this.db.batch();
        this.auth = firebase.auth();
        this.storageRef = firebase.storage().ref();
    }

    protected initializeDbFireStore(types: (new () => any)[]): void {
        if (types) {
            for (const type of types) {
                let entity = new type();
                const dbSetFieldName = this.lowercaseFirstLetter(entity.constructor.name);
                (<any>this)[dbSetFieldName] = new DbSet(type, entity, this.db, this.batch);
                this.dbSetFieldNames.push(dbSetFieldName);
            }
        }
    }

    public async set<T extends AbstractEntity>(entity: T | undefined) {

        this.validateEntityBeforeWrite(entity);

        await this.prepareFileForUpload(entity);

        const entityName = (<T>entity).constructor.name;

        if (this.addPagination) {
            this.entitySetCount++;
            (<T>entity).FieldOrderNumber = await this.getLastFieldOrderNumber(entityName);
        }

        const ref = this.db.collection((<T>entity).constructor.name)
            .doc((<T>entity).Id);

        this.batch.set(ref, (<T>entity).asObject());
    }

    public uploadFile(file: StorageFile) {

        if (typeof file.File === "string")
            return this.storageRef.child(file.fullPath()).putString(file.File, "data_url");

        return this.storageRef.child(file.fullPath()).put(file.File);
    }

    private update<T extends AbstractEntity>(entity: T | undefined): void {

        this.validateEntityBeforeWrite(entity);

        const ref = this.db.collection((<T>entity).constructor.name)
            .doc((<T>entity).Id);

        this.batch.update(ref, (<T>entity).asObject());
    }

    public delete<T extends AbstractEntity>(entity: T | undefined): void {

        this.validateEntityBeforeWrite(entity);

        const ref = this.db.collection((<T>entity).constructor.name)
            .doc((<T>entity).Id);

        this.batch.delete(ref);
    }

    //TODO There is a problem with long running code that is going to be updated
    //     It does not update
    public handleLongRunningCode(running: () => Promise<void>): void {
        this.longRunningThread = true;

        running().then(value => {
            console.log('AM I DONE', value);
            this.longRunningThread = false;
        }).catch(error => {
            this.writeError = true;
            this.longRunningThread = false;
            console.error(error);
        })
    }

    //TODO Use a tracking system: https://docs.microsoft.com/en-us/ef/core/querying/tracking
    public async saveChangesAsync() {

        try {
            if (this.writeError) {
                console.log("Unable to save changes. There was an error on the DB context.")
                return;
            }

            const dbSets = this.getDbSets().filter(dbSet => dbSet);

            if (dbSets.length === 0)
                throw new Error("There is no entities to save");

            this.updateObservableEntities(dbSets);

            return this.batch.commit();
        } catch (error) {
            throw new Error(error.message)
        } finally {
            this.batch = this.db.batch();
            this.entitySetCount = 0;
        }
    }

    //TODO Use a tracking system: https://docs.microsoft.com/en-us/ef/core/querying/tracking
    public async expensivelySaveChangesAsync() {
        let i = 0;
        return new Promise<boolean>((resolve, reject) => {
            try {
                const dbSets = this.getDbSets().filter(dbSet => dbSet);

                if (dbSets.length === 0)
                    reject("There is no entities to save");

                setTimeout(() => {
                    clearInterval(this.check);
                    reject("Unable to save change. The process is still running concurrently");
                }, this.fetchTimeOut);

                let alreadyCommitted = false;
                //TODO This mite not be a good idea, maybe use on-change to detect when is the right time to commit
                this.check = setInterval(async () => {
                    try {
                        i++;
                        console.log(this.longRunningThread, i, alreadyCommitted, this.writeError);
                        if (!this.longRunningThread && !alreadyCommitted) {
                            const stillRun = dbSets.filter(dbSet => dbSet.isRunConcurrently);

                            console.log(stillRun.length);
                            if (stillRun.length === 0 && !alreadyCommitted) {

                                this.updateObservableEntities(dbSets);

                                if (!this.writeError && !alreadyCommitted) {
                                    alreadyCommitted = true;
                                    await this.batch.commit()
                                    resolve(true);
                                }
                                clearInterval(this.check);
                            }
                        }
                    } catch (error) {
                        clearInterval(this.check);
                        reject(`Unable to save changes, ${error}`);
                    }
                }, 50);
            } catch (error) {
                reject(`Unable to save changes, ${error}`)
            }
        });
    }

    private getDbSets(): DbSet<any>[] {
        return this.dbSetFieldNames.map(dbSetFieldName => <DbSet<any>>(<any>this)[dbSetFieldName]);
    }

    private updateObservableEntities(dbSets: DbSet<any>[]): void {
        const entitiesToUpdate = dbSets
            .map(dbSet => dbSet.observableEntities.filter(o => o.haveEntityChanged))
            .flat();

        for (const entitiesToUpdateElement of entitiesToUpdate) {
            this.update(entitiesToUpdateElement.entity);
        }
    }

    private validateEntityBeforeWrite<T extends AbstractEntity>(entity: T | undefined) {
        if (!entity) {
            this.writeError = true;
            //TODO Improve error message
            throw new Error(`Please provide entity to write`);
        }

        if (!entity.Id) {
            this.writeError = true;
            throw new Error(`Entity(${(<T>entity).constructor.name}) doesn't have unique identifier(id)`);
        }
    }

    //TODO This is workaround for firebase bug. Data wound save in async function or call back function.
    //     after waiting for one second, then data save.
    private async shouldWait(wait: boolean, func: () => void) {
        if (wait) {
            setTimeout(func, 1000);
        } else {
            await func();
        }
    }

    private lowercaseFirstLetter(str: any): string {
        return str.charAt(0).toLowerCase() + str.slice(1);
    }

    public async getLastFieldOrderNumber(entityName: string): Promise<number> {
        try {
            const collectionReference = this.db.collection(entityName);
            const querySnapshot = await collectionReference
                .orderBy("fieldOrderNumber")
                .limitToLast(1)
                .get();

            if (this.entitySetCount > 1 && querySnapshot.empty) {
                return this.entitySetCount;
            }

            if (querySnapshot.empty) {
                return 1;
            } else {
                const entity = querySnapshot.docs[0].data();

                if (entity.fieldOrderNumber === undefined ||
                    entity.fieldOrderNumber === null ||
                    isNaN(entity.fieldOrderNumber)) {

                    throw new Error(`Entity with id: ${entity.id} field order number is undefined, null or NaN`);
                }

                if (this.entitySetCount > 1) {
                    return ++entity.fieldOrderNumber + (this.entitySetCount - 1);
                } else {
                    return ++entity.fieldOrderNumber;
                }
            }
        } catch (error) {
            this.writeError = true;
            console.error("Unable to process pagination", error);
            throw new Error(`Unable to process pagination ${error}`);
        }
    }

    private async prepareFileForUpload(entity: any) {
        const entityKeys = Object.keys(entity);

        for (const entityKey of entityKeys) {
            if (entity[entityKey] && typeof entity[entityKey] === "object") {
                await this.prepareFileForUpload(entity[entityKey]);
            }
        }

        await this.searchFileToUpload(entity);
    }

    private async searchFileToUpload(entity: any) {
        const fileValues = DecoratorTool.getMyPropertyDecoratorValues(entity.constructor, "FileField");

        //TODO This should be more asynchronous
        for (const fileValue of fileValues) {
            const file = (<StorageFile>entity[fileValue]);

            if (Condition.isNotUndefined(file) && Condition.isNotNull(file)) {
                const task = this.uploadFile(file);

               file.Url = await this.uploadFileTask(task);
            }
        }
    }

    private async uploadFileTask(task: UploadTask) {
        return new Promise<string>((resolve, reject) => {
            task.on("state_changed",
                () => {},
                (error) => {
                    reject(`Unable to save file. ${error.message}`)
                },
                () => {
                    console.log("File is uplodade");
                    task.snapshot.ref.getDownloadURL()
                        .then(url => resolve(url))
                        .catch(error => reject(error.message));
                });
        });
    }
}