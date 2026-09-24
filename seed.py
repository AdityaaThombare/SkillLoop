"""Create an empty SkillLoop database: the skills catalog only. No people, no teams, no fake activity.

Everything else (accounts, offers, wants, teams, trades, ratings) is created by real users as they use the site.
Want sample people to try it alone? Optionally run:  python demo_data.py
"""
import os
import sqlite3

import recommender

DB_PATH = os.path.join(os.path.dirname(__file__), "skillloop.db")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")

SKILLS = [
    ("Python Basics", "Programming"), ("Web Development", "Programming"), ("React", "Programming"),
    ("Node.js", "Programming"), ("Java", "Programming"), ("C++", "Programming"),
    ("Android Development", "Programming"), ("Flutter", "Programming"), ("SQL & Databases", "Programming"),
    ("Git & GitHub", "DevOps"), ("Docker", "DevOps"), ("Linux", "DevOps"),
    ("Machine Learning", "Data"), ("Deep Learning", "Data"), ("Data Analysis", "Data"), ("Data Visualization", "Data"),
    ("UI/UX Design", "Design"), ("Figma", "Design"), ("Graphic Design", "Design"),
    ("Pitching", "Business"), ("Project Management", "Business"), ("Public Speaking", "Business"),
    ("Marketing", "Business"), ("Finance Basics", "Business"),
    ("Resume Review", "Career"), ("Interview Prep", "Career"), ("LinkedIn Profile Help", "Career"),
    ("Embedded Systems", "Hardware"), ("Arduino", "Hardware"), ("Robotics", "Hardware"),
    ("Cybersecurity Basics", "Security"), ("Ethical Hacking", "Security"),
    ("Photography", "Creative"), ("Video Editing", "Creative"), ("Content Writing", "Creative"), ("Music Production", "Creative"),
    ("Guitar Lessons", "Music"), ("Piano", "Music"),
    ("Football Coaching", "Sports"), ("Chess", "Sports"),
    ("Spanish", "Languages"), ("German", "Languages"), ("Japanese", "Languages"),
]

with sqlite3.connect(DB_PATH) as conn:
    conn.executescript(open(SCHEMA_PATH).read())
    conn.executemany("INSERT INTO skills (name, category) VALUES (?, ?)", SKILLS)
    conn.commit()

print(f"Created skillloop.db with {len(SKILLS)} skills and no users. The first person to register becomes the first member.")
r = recommender.train_team_model([s[0] for s in SKILLS])
print("Trained the synthetic warm-start model (replaced by real data as it arrives):", r["metrics"])
