"""OPTIONAL: add a few sample people and teams so you can try loops and teams on your own.
Run after seed.py. Sample users all have the password  skillloop123. Not needed for real use."""
import os
import sqlite3
from werkzeug.security import generate_password_hash

DB = os.path.join(os.path.dirname(__file__), "skillloop.db")
pw = generate_password_hash("skillloop123")
people = ["Aaditya", "Riya", "Sameer", "Neha", "Kabir", "Ishaan", "Meera"]
offers = [("Aaditya", "Python Basics"), ("Riya", "Guitar Lessons"), ("Sameer", "Resume Review"), ("Neha", "Football Coaching"),
          ("Kabir", "Photography"), ("Aaditya", "Web Development"), ("Riya", "UI/UX Design"), ("Sameer", "Pitching"),
          ("Neha", "Machine Learning"), ("Kabir", "Video Editing"), ("Ishaan", "React"), ("Meera", "Data Analysis")]
wants = [("Aaditya", "Guitar Lessons"), ("Riya", "Resume Review"), ("Sameer", "Python Basics"), ("Neha", "Python Basics"),
         ("Kabir", "Football Coaching"), ("Aaditya", "Photography")]
teams = [("Neha", "Campus Crew", "Smart India Hackathon", "Campus mobility app.", 4, ["React", "UI/UX Design", "Pitching"]),
         ("Meera", "DataDrift", "HackVIT", "Forecasting canteen demand.", 3, ["Machine Learning", "Python Basics"])]
with sqlite3.connect(DB) as c:
    c.execute("PRAGMA foreign_keys = ON")
    U = lambda n: c.execute("SELECT id FROM users WHERE name=?", (n,)).fetchone()[0]
    S = lambda n: c.execute("SELECT id FROM skills WHERE name=?", (n,)).fetchone()[0]
    for n in people:
        c.execute("INSERT OR IGNORE INTO users (name, email, password_hash) VALUES (?, ?, ?)", (n, n.lower() + "@vit.edu", pw))
    c.executemany("INSERT OR IGNORE INTO offers (user_id, skill_id) VALUES (?, ?)", [(U(u), S(s)) for u, s in offers])
    c.executemany("INSERT OR IGNORE INTO wants (user_id, skill_id) VALUES (?, ?)", [(U(u), S(s)) for u, s in wants])
    for creator, name, hack, desc, size, needs in teams:
        tid = c.execute("INSERT INTO teams (name, hackathon, description, max_size, creator_id) VALUES (?,?,?,?,?)", (name, hack, desc, size, U(creator))).lastrowid
        c.executemany("INSERT INTO team_needs (team_id, skill_id) VALUES (?, ?)", [(tid, S(n)) for n in needs])
        c.execute("INSERT INTO team_members (team_id, user_id, status) VALUES (?, ?, 'member')", (tid, U(creator)))
print("Added sample people. Sign in as aaditya@vit.edu / skillloop123")
