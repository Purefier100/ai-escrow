# escrow.py

class Escrow:

    def __init__(self):
        self.jobs = {}

    def create_job(self, job_id, description):
        self.jobs[job_id] = {
            "description": description,
            "submission": "",
            "approved": False
        }

    def submit_work(self, job_id, submission):
        self.jobs[job_id]["submission"] = submission

    def evaluate(self, job_id):
        job = self.jobs[job_id]

        prompt = f"""
        TASK: {job['description']}
        SUBMISSION: {job['submission']}

        Return PASS or FAIL only.
        """

        # simulate AI consensus (3 validators)
        results = []

        for _ in range(3):
            if len(job["submission"]) > 10:
                results.append("PASS")
            else:
                results.append("FAIL")

        pass_count = results.count("PASS")

        if pass_count >= 2:
            job["approved"] = True
            return "PASS"
        else:
            return "FAIL"